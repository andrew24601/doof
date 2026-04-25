#include "native_boardgame_host.hpp"

#import <Foundation/Foundation.h>
#import <QuartzCore/CADisplayLink.h>
#import <QuartzCore/CAMetalLayer.h>
#import <UIKit/UIKit.h>

#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <engine/render/MetalRenderer.h>
#include <engine/render/TextureRegistry.h>
#include <engine/render/Vertex.h>

@interface DoofBoardgameDisplayLinkTarget : NSObject

- (void)tick:(CADisplayLink*)displayLink;

@end

@interface DoofBoardgameMetalView : UIView
@end

namespace doof_boardgame_host {
namespace {

using Clock = std::chrono::steady_clock;

struct QueuedEvent {
    NativeBoardgameEventKind kind;
    float x = 0.0f;
    float y = 0.0f;
    float wheelY = 0.0f;
    NativeBoardgameKey key = NativeBoardgameKey::Unknown;
};

struct IOSSharedState {
    std::mutex mutex;
    std::condition_variable eventReady;
    std::vector<QueuedEvent> pendingEvents;
    DoofBoardgameMetalView* metalView = nil;
    CAMetalLayer* metalLayer = nil;
    CADisplayLink* displayLink = nil;
    DoofBoardgameDisplayLinkTarget* displayLinkTarget = nil;
    bool open = true;
    int32_t windowWidth = 0;
    int32_t windowHeight = 0;
    int32_t pixelWidth = 0;
    int32_t pixelHeight = 0;
    float dpiScale = 1.0f;
    std::string assetBasePath;
};

IOSSharedState& sharedState() {
    static IOSSharedState state;
    return state;
}

Clock::time_point processStartTime() {
    static const Clock::time_point start = Clock::now();
    return start;
}

std::string bundleResourceBasePath() {
    NSBundle* bundle = [NSBundle mainBundle];
    NSString* resourcePath = [bundle resourcePath];
    if (!resourcePath) {
        return {};
    }

    std::string path([resourcePath fileSystemRepresentation]);
    if (!path.empty() && path.back() != '/') {
        path.push_back('/');
    }
    return path;
}

std::shared_ptr<NativeBoardgameEvent> makeEvent(
    NativeBoardgameEventKind kind,
    float x = 0.0f,
    float y = 0.0f,
    float wheelY = 0.0f,
    NativeBoardgameKey key = NativeBoardgameKey::Unknown
) {
    return std::make_shared<NativeBoardgameEvent>(kind, x, y, wheelY, key);
}

void pushEvent(const QueuedEvent& event) {
    IOSSharedState& state = sharedState();

    {
        std::lock_guard<std::mutex> lock(state.mutex);
        if (!state.open) {
            return;
        }

        if (event.kind == NativeBoardgameEventKind::RenderRequested) {
            for (const auto& pending : state.pendingEvents) {
                if (pending.kind == NativeBoardgameEventKind::RenderRequested) {
                    return;
                }
            }
        }

        state.pendingEvents.push_back(event);
    }

    state.eventReady.notify_all();
}

void updateMetricsFromView(UIView* view) {
    if (view == nil) {
        return;
    }

    UIScreen* screen = view.window != nil ? view.window.screen : UIScreen.mainScreen;
    const CGFloat scale = screen != nil ? screen.scale : 1.0;
    const CGSize size = view.bounds.size;

    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    state.windowWidth = static_cast<int32_t>(std::lround(size.width));
    state.windowHeight = static_cast<int32_t>(std::lround(size.height));
    state.pixelWidth = static_cast<int32_t>(std::lround(size.width * scale));
    state.pixelHeight = static_cast<int32_t>(std::lround(size.height * scale));
    state.dpiScale = static_cast<float>(scale);

    if (state.metalLayer != nil) {
        state.metalLayer.frame = view.bounds;
        state.metalLayer.contentsScale = scale;
    }
}

CGPoint touchLocationInView(UIView* view, NSSet<UITouch*>* touches) {
    UITouch* touch = [touches anyObject];
    if (touch == nil || view == nil) {
        return CGPointZero;
    }

    return [touch locationInView:view];
}

UIWindow* fallbackApplicationWindow() {
    NSSet<UIScene*>* scenes = UIApplication.sharedApplication.connectedScenes;
    for (UIScene* scene in scenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }

        UIWindowScene* windowScene = (UIWindowScene*)scene;
        if (windowScene.activationState != UISceneActivationStateForegroundActive) {
            continue;
        }

        for (UIWindow* window in windowScene.windows) {
            if (window.isKeyWindow) {
                return window;
            }
        }

        UIWindow* firstWindow = windowScene.windows.firstObject;
        if (firstWindow != nil) {
            return firstWindow;
        }
    }

    return nil;
}

std::string installIOSSurface() {
    __block NSString* errorMessage = nil;

    dispatch_sync(dispatch_get_main_queue(), ^{
        IOSSharedState& state = sharedState();

        id delegate = UIApplication.sharedApplication.delegate;
        UIWindow* window = nil;
        if ([delegate respondsToSelector:@selector(window)]) {
            window = [delegate window];
        }
        if (window == nil) {
            window = fallbackApplicationWindow();
        }
        if (window == nil) {
            errorMessage = @"UIApplication window is not ready.";
            return;
        }

        UIViewController* rootViewController = window.rootViewController;
        if (rootViewController == nil) {
            rootViewController = [[[UIViewController alloc] init] autorelease];
            window.rootViewController = rootViewController;
        }

        UIView* rootView = rootViewController.view;
        if (rootView == nil) {
            errorMessage = @"UIApplication root view is not ready.";
            return;
        }

        rootView.backgroundColor = UIColor.blackColor;

        if (state.metalView == nil) {
            state.metalView = [[DoofBoardgameMetalView alloc] initWithFrame:rootView.bounds];
            state.metalView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
            [rootView addSubview:state.metalView];
            state.metalLayer = (CAMetalLayer*)state.metalView.layer;
        } else if (state.metalView.superview != rootView) {
            [state.metalView removeFromSuperview];
            [rootView addSubview:state.metalView];
        }

        if (state.displayLink == nil) {
            state.displayLinkTarget = [[DoofBoardgameDisplayLinkTarget alloc] init];
            state.displayLink = [[CADisplayLink displayLinkWithTarget:state.displayLinkTarget selector:@selector(tick:)] retain];
            state.displayLink.preferredFramesPerSecond = 60;
            [state.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
        }

        state.open = true;
        state.assetBasePath = bundleResourceBasePath();
        updateMetricsFromView(state.metalView);
    });

    return errorMessage != nil ? std::string([errorMessage UTF8String]) : std::string();
}

void teardownIOSSurface() {
    dispatch_sync(dispatch_get_main_queue(), ^{
        IOSSharedState& state = sharedState();

        if (state.displayLink != nil) {
            [state.displayLink invalidate];
            [state.displayLink release];
            state.displayLink = nil;
        }
        if (state.displayLinkTarget != nil) {
            [state.displayLinkTarget release];
            state.displayLinkTarget = nil;
        }
        if (state.metalView != nil) {
            [state.metalView removeFromSuperview];
            [state.metalView release];
            state.metalView = nil;
        }
        state.metalLayer = nil;
    });
}

void addDrawsToBatches(
    std::vector<RenderBatch>& batches,
    TextureRegistry& textures,
    const std::shared_ptr<WorldRenderPlan>& plan
) {
    for (const auto& draw : *plan->draws) {
        if (draw->vertices->empty() || draw->textureId < 0) {
            continue;
        }

        id<MTLTexture> texture = textures.getTexture(draw->textureId);
        if (texture == nil) {
            continue;
        }

        std::vector<Vertex> vertices;
        vertices.reserve(draw->vertices->size());
        for (const auto& rv : *draw->vertices) {
            Vertex vertex;
            vertex.x = rv->x;
            vertex.y = rv->y;
            vertex.z = rv->z;
            vertex.u = rv->u;
            vertex.v = rv->v;
            vertex.alpha = rv->alpha;
            vertices.push_back(vertex);
        }

        if (batches.empty() || batches.back().texture != texture) {
            batches.push_back({texture, {}});
        }

        auto& current = batches.back().vertices;
        current.insert(current.end(), vertices.begin(), vertices.end());
    }
}

} // anonymous namespace

struct NativeBoardgameHost::Impl {
    CAMetalLayer* layer = nil;
    MetalRenderer renderer;
    std::unique_ptr<TextureRegistry> textures;
    bool open = true;
    float frameDeltaSeconds = 0.0f;
    std::string assetBasePath;
    Clock::time_point lastPollTime = Clock::now();
};

NativeBoardgameEvent::NativeBoardgameEvent(
    NativeBoardgameEventKind kind,
    float x,
    float y,
    float wheelY,
    NativeBoardgameKey key
) : kind_(kind), x_(x), y_(y), wheelY_(wheelY), key_(key) {}

NativeBoardgameEventKind NativeBoardgameEvent::kind() const {
    return kind_;
}

float NativeBoardgameEvent::x() const {
    return x_;
}

float NativeBoardgameEvent::y() const {
    return y_;
}

float NativeBoardgameEvent::wheelY() const {
    return wheelY_;
}

NativeBoardgameKey NativeBoardgameEvent::key() const {
    return key_;
}

NativeBoardgameHost::NativeBoardgameHost(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

NativeBoardgameHost::~NativeBoardgameHost() {
    close();
}

doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string> NativeBoardgameHost::create(
    const std::string& title,
    int32_t width,
    int32_t height
) {
    (void)title;
    (void)width;
    (void)height;

    const std::string installError = installIOSSurface();
    if (!installError.empty()) {
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(installError);
    }

    auto impl = std::make_unique<Impl>();

    {
        IOSSharedState& state = sharedState();
        std::lock_guard<std::mutex> lock(state.mutex);
        impl->layer = state.metalLayer;
        impl->assetBasePath = state.assetBasePath;
    }

    if (impl->layer == nil) {
        teardownIOSSurface();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure("UIKit Metal surface initialization failed");
    }

    if (!impl->renderer.init(impl->layer)) {
        teardownIOSSurface();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure("Metal renderer initialization failed");
    }

    impl->textures = std::make_unique<TextureRegistry>(impl->renderer.device(), impl->renderer.commandQueue());
    impl->lastPollTime = Clock::now();

    return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::success(
        std::shared_ptr<NativeBoardgameHost>(new NativeBoardgameHost(std::move(impl)))
    );
}

bool NativeBoardgameHost::isOpen() const {
    if (impl_ == nullptr || !impl_->open) {
        return false;
    }

    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.open;
}

std::shared_ptr<std::vector<std::shared_ptr<NativeBoardgameEvent>>> NativeBoardgameHost::pollEvents(bool canNap) {
    auto events = std::make_shared<std::vector<std::shared_ptr<NativeBoardgameEvent>>>();
    if (impl_ == nullptr || !impl_->open) {
        return events;
    }

    std::vector<QueuedEvent> queuedEvents;
    {
        IOSSharedState& state = sharedState();
        std::unique_lock<std::mutex> lock(state.mutex);
        if (canNap && state.pendingEvents.empty() && state.open) {
            state.eventReady.wait(lock, [&state] { return !state.pendingEvents.empty() || !state.open; });
        }
        queuedEvents.swap(state.pendingEvents);
        impl_->open = state.open;
    }

    const Clock::time_point now = Clock::now();
    impl_->frameDeltaSeconds = std::chrono::duration<float>(now - impl_->lastPollTime).count();
    impl_->lastPollTime = now;

    events->reserve(queuedEvents.size());
    for (const auto& event : queuedEvents) {
        events->push_back(makeEvent(event.kind, event.x, event.y, event.wheelY, event.key));
    }

    return events;
}

float NativeBoardgameHost::frameDeltaSeconds() const {
    return impl_ ? impl_->frameDeltaSeconds : 0.0f;
}

int32_t NativeBoardgameHost::windowWidth() const {
    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.windowWidth;
}

int32_t NativeBoardgameHost::windowHeight() const {
    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.windowHeight;
}

int32_t NativeBoardgameHost::pixelWidth() const {
    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.pixelWidth;
}

int32_t NativeBoardgameHost::pixelHeight() const {
    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.pixelHeight;
}

float NativeBoardgameHost::dpiScale() const {
    IOSSharedState& state = sharedState();
    std::lock_guard<std::mutex> lock(state.mutex);
    return state.dpiScale;
}

std::string NativeBoardgameHost::assetBasePath() const {
    return impl_ ? impl_->assetBasePath : std::string();
}

bool NativeBoardgameHost::loadTextureWithId(int32_t textureId, const std::string& path) {
    if (impl_ == nullptr) {
        std::fprintf(stderr, "NativeBoardgameHost::loadTextureWithId called with null impl\n");
        return false;
    }

    if (impl_->textures == nullptr) {
        std::fprintf(stderr, "NativeBoardgameHost::loadTextureWithId called with null texture registry\n");
        return false;
    }

    std::filesystem::path resolved(path);
    if (resolved.is_relative()) {
        resolved = std::filesystem::current_path() / resolved;
    }
    resolved = resolved.lexically_normal();

    return impl_->textures->loadTextureWithId(textureId, resolved.string());
}

int32_t NativeBoardgameHost::createSolidColorTexture(int32_t r, int32_t g, int32_t b, int32_t a) {
    if (impl_ == nullptr || impl_->textures == nullptr) {
        return -1;
    }

    return impl_->textures->createSolidColor(
        static_cast<uint8_t>(r),
        static_cast<uint8_t>(g),
        static_cast<uint8_t>(b),
        static_cast<uint8_t>(a)
    );
}

int32_t NativeBoardgameHost::ticks() const {
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - processStartTime()).count();
    return static_cast<int32_t>(std::min<int64_t>(elapsed, std::numeric_limits<int32_t>::max()));
}

void NativeBoardgameHost::render(
    std::shared_ptr<WorldRenderPlan> world,
    std::shared_ptr<doof_boardgame::Mat4> worldMvp,
    std::shared_ptr<WorldRenderPlan> ui,
    std::shared_ptr<doof_boardgame::Mat4> uiMvp
) {
    if (impl_ == nullptr || !impl_->open || impl_->textures == nullptr || world == nullptr || ui == nullptr || worldMvp == nullptr || uiMvp == nullptr) {
        return;
    }

    const int32_t currentPixelWidth = pixelWidth();
    const int32_t currentPixelHeight = pixelHeight();
    if (currentPixelWidth <= 0 || currentPixelHeight <= 0) {
        return;
    }

    std::vector<RenderBatch> worldBatches;
    addDrawsToBatches(worldBatches, *impl_->textures, world);

    std::vector<RenderBatch> uiBatches;
    addDrawsToBatches(uiBatches, *impl_->textures, ui);

    impl_->renderer.renderFrame(
        impl_->layer,
        worldBatches,
        worldMvp->m,
        uiBatches,
        uiMvp->m,
        currentPixelWidth,
        currentPixelHeight
    );
}

void NativeBoardgameHost::close() {
    if (impl_ == nullptr) {
        return;
    }

    impl_->open = false;
    impl_->textures.reset();

    {
        IOSSharedState& state = sharedState();
        std::lock_guard<std::mutex> lock(state.mutex);
        state.open = false;
        state.pendingEvents.clear();
        state.windowWidth = 0;
        state.windowHeight = 0;
        state.pixelWidth = 0;
        state.pixelHeight = 0;
        state.dpiScale = 1.0f;
    }
    sharedState().eventReady.notify_all();

    teardownIOSSurface();
}

} // namespace doof_boardgame_host

@implementation DoofBoardgameDisplayLinkTarget

- (void)tick:(CADisplayLink*)displayLink {
    (void)displayLink;
    doof_boardgame_host::pushEvent({NativeBoardgameEventKind::RenderRequested});
}

@end

@implementation DoofBoardgameMetalView

+ (Class)layerClass {
    return [CAMetalLayer class];
}

- (instancetype)initWithFrame:(CGRect)frame {
    self = [super initWithFrame:frame];
    if (self != nil) {
        self.backgroundColor = UIColor.blackColor;
        self.multipleTouchEnabled = NO;
        self.opaque = YES;
    }
    return self;
}

- (void)layoutSubviews {
    [super layoutSubviews];
    doof_boardgame_host::updateMetricsFromView(self);
    doof_boardgame_host::pushEvent({NativeBoardgameEventKind::RenderRequested});
}

- (void)didMoveToWindow {
    [super didMoveToWindow];
    doof_boardgame_host::updateMetricsFromView(self);
    doof_boardgame_host::pushEvent({NativeBoardgameEventKind::RenderRequested});
}

- (void)touchesBegan:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    (void)event;
    const CGPoint point = doof_boardgame_host::touchLocationInView(self, touches);
    doof_boardgame_host::pushEvent({
        NativeBoardgameEventKind::MouseDown,
        static_cast<float>(point.x),
        static_cast<float>(point.y),
    });
}

- (void)touchesMoved:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    (void)event;
    const CGPoint point = doof_boardgame_host::touchLocationInView(self, touches);
    doof_boardgame_host::pushEvent({
        NativeBoardgameEventKind::MouseMove,
        static_cast<float>(point.x),
        static_cast<float>(point.y),
    });
}

- (void)touchesEnded:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    (void)event;
    const CGPoint point = doof_boardgame_host::touchLocationInView(self, touches);
    doof_boardgame_host::pushEvent({
        NativeBoardgameEventKind::MouseUp,
        static_cast<float>(point.x),
        static_cast<float>(point.y),
    });
}

- (void)touchesCancelled:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    [self touchesEnded:touches withEvent:event];
}

@end