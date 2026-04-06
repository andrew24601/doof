#include "native_boardgame_host.hpp"

#include <SDL3/SDL.h>
#include <SDL3/SDL_metal.h>

#import <Foundation/Foundation.h>
#import <QuartzCore/CAMetalLayer.h>

#include <cstdio>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include <engine/render/MetalRenderer.h>
#include <engine/render/TextureRegistry.h>
#include <engine/render/Vertex.h>

namespace doof_boardgame_host {
namespace {

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

std::string resolveAssetBasePath() {
    std::string bundlePath = bundleResourceBasePath();
    if (!bundlePath.empty()) {
        return bundlePath;
    }

    const char* basePath = SDL_GetBasePath();
    return basePath ? std::string(basePath) : std::string();
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

NativeBoardgameKey debugKeyCodeForScancode(SDL_Scancode scancode) {
    switch (scancode) {
        case SDL_SCANCODE_W: return NativeBoardgameKey::W;
        case SDL_SCANCODE_A: return NativeBoardgameKey::A;
        case SDL_SCANCODE_S: return NativeBoardgameKey::S;
        case SDL_SCANCODE_D: return NativeBoardgameKey::D;
        case SDL_SCANCODE_Q: return NativeBoardgameKey::Q;
        case SDL_SCANCODE_E: return NativeBoardgameKey::E;
        default: return NativeBoardgameKey::Unknown;
    }
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
    SDL_Window* window = nullptr;
    SDL_MetalView metalView = nullptr;
    CAMetalLayer* layer = nil;
    MetalRenderer renderer;
    std::unique_ptr<TextureRegistry> textures;
    bool sdlOwned = false;
    bool open = true;
    Uint64 lastTicks = 0;
    float frameDeltaSeconds = 0.0f;
    std::string assetBasePath;
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
    SDL_SetHint(SDL_HINT_VIDEO_ALLOW_SCREENSAVER, "1");

    if (!SDL_Init(SDL_INIT_VIDEO)) {
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(SDL_GetError());
    }

    auto impl = std::make_unique<Impl>();
    impl->sdlOwned = true;

#if TARGET_OS_IOS
    impl->window = SDL_CreateWindow(
        title.c_str(),
        0,
        0,
        SDL_WINDOW_FULLSCREEN | SDL_WINDOW_HIGH_PIXEL_DENSITY | SDL_WINDOW_METAL | SDL_WINDOW_BORDERLESS
    );
#else
    impl->window = SDL_CreateWindow(
        title.c_str(),
        width,
        height,
        SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY | SDL_WINDOW_METAL
    );
#endif

    if (impl->window == nullptr) {
        const std::string error = SDL_GetError();
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(error);
    }

    impl->metalView = SDL_Metal_CreateView(impl->window);
    if (impl->metalView == nullptr) {
        const std::string error = SDL_GetError();
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(error);
    }

    impl->layer = (__bridge CAMetalLayer*)SDL_Metal_GetLayer(impl->metalView);
    if (impl->layer == nil) {
        const std::string error = SDL_GetError();
        SDL_Metal_DestroyView(impl->metalView);
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(error);
    }

    if (!impl->renderer.init(impl->layer)) {
        SDL_Metal_DestroyView(impl->metalView);
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure("Metal renderer initialization failed");
    }

    impl->textures = std::make_unique<TextureRegistry>(impl->renderer.device(), impl->renderer.commandQueue());
    impl->assetBasePath = resolveAssetBasePath();
    impl->lastTicks = SDL_GetTicks();

    return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::success(
        std::shared_ptr<NativeBoardgameHost>(new NativeBoardgameHost(std::move(impl)))
    );
}

bool NativeBoardgameHost::isOpen() const {
    return impl_ != nullptr && impl_->open;
}

std::shared_ptr<std::vector<std::shared_ptr<NativeBoardgameEvent>>> NativeBoardgameHost::pollEvents(bool canNap) {
    auto events = std::make_shared<std::vector<std::shared_ptr<NativeBoardgameEvent>>>();
    if (impl_ == nullptr || !impl_->open) {
        return events;
    }

    const Uint64 currentTicks = SDL_GetTicks();
    impl_->frameDeltaSeconds = static_cast<float>(currentTicks - impl_->lastTicks) / 1000.0f;
    impl_->lastTicks = currentTicks;

    SDL_Event event;
    while (canNap ? SDL_WaitEvent(&event) : SDL_PollEvent(&event)) {
        canNap = false;
        switch (event.type) {
            case SDL_EVENT_QUIT:
            case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
                impl_->open = false;
                events->push_back(makeEvent(NativeBoardgameEventKind::CloseRequested));
                break;
            case SDL_EVENT_WINDOW_RESIZED:
            case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
            case SDL_EVENT_WINDOW_EXPOSED:
                events->push_back(makeEvent(NativeBoardgameEventKind::RenderRequested));
                break;
            case SDL_EVENT_KEY_DOWN: {
                const bool hasCommandModifier = (event.key.mod & SDL_KMOD_GUI) != 0;
                if (hasCommandModifier) {
                    switch (event.key.scancode) {
                        case SDL_SCANCODE_Z:
                            if ((event.key.mod & SDL_KMOD_SHIFT) != 0) {
                                events->push_back(makeEvent(NativeBoardgameEventKind::RedoRequested));
                            } else {
                                events->push_back(makeEvent(NativeBoardgameEventKind::UndoRequested));
                            }
                            continue;
                        case SDL_SCANCODE_Y:
                            events->push_back(makeEvent(NativeBoardgameEventKind::RedoRequested));
                            continue;
                        case SDL_SCANCODE_Q:
                        case SDL_SCANCODE_W:
                            impl_->open = false;
                            events->push_back(makeEvent(NativeBoardgameEventKind::CloseRequested));
                            continue;
                        default:
                            break;
                    }
                }

                switch (event.key.scancode) {
                    case SDL_SCANCODE_ESCAPE:
                        events->push_back(makeEvent(NativeBoardgameEventKind::EscapeRequested));
                        break;
                    case SDL_SCANCODE_N:
                        events->push_back(makeEvent(NativeBoardgameEventKind::NewGameRequested));
                        break;
                    case SDL_SCANCODE_M:
                        events->push_back(makeEvent(NativeBoardgameEventKind::AutoCompleteRequested));
                        break;
                    case SDL_SCANCODE_SPACE:
                        events->push_back(makeEvent(NativeBoardgameEventKind::ToggleAutoCameraRequested));
                        break;
                    default: {
                        const NativeBoardgameKey key = debugKeyCodeForScancode(event.key.scancode);
                        if (key != NativeBoardgameKey::Unknown) {
                            events->push_back(makeEvent(NativeBoardgameEventKind::KeyDown, 0.0f, 0.0f, 0.0f, key));
                        }
                        break;
                    }
                }
                break;
            }
            case SDL_EVENT_KEY_UP: {
                const NativeBoardgameKey key = debugKeyCodeForScancode(event.key.scancode);
                if (key != NativeBoardgameKey::Unknown) {
                    events->push_back(makeEvent(NativeBoardgameEventKind::KeyUp, 0.0f, 0.0f, 0.0f, key));
                }
                break;
            }
            case SDL_EVENT_MOUSE_BUTTON_DOWN:
                if (event.button.button == SDL_BUTTON_LEFT) {
                    events->push_back(makeEvent(NativeBoardgameEventKind::MouseDown, event.button.x, event.button.y));
                }
                break;
            case SDL_EVENT_MOUSE_BUTTON_UP:
                if (event.button.button == SDL_BUTTON_LEFT) {
                    events->push_back(makeEvent(NativeBoardgameEventKind::MouseUp, event.button.x, event.button.y));
                }
                break;
            case SDL_EVENT_MOUSE_MOTION:
                events->push_back(makeEvent(NativeBoardgameEventKind::MouseMove, event.motion.x, event.motion.y));
                break;
            case SDL_EVENT_MOUSE_WHEEL:
                events->push_back(makeEvent(NativeBoardgameEventKind::MouseWheel, 0.0f, 0.0f, static_cast<float>(event.wheel.y)));
                break;
            default:
                break;
        }
    }

    return events;
}

float NativeBoardgameHost::frameDeltaSeconds() const {
    return impl_ ? impl_->frameDeltaSeconds : 0.0f;
}

int32_t NativeBoardgameHost::windowWidth() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSize(impl_->window, &width, &height);
    return width;
}

int32_t NativeBoardgameHost::windowHeight() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSize(impl_->window, &width, &height);
    return height;
}

int32_t NativeBoardgameHost::pixelWidth() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(impl_->window, &width, &height);
    return width;
}

int32_t NativeBoardgameHost::pixelHeight() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(impl_->window, &width, &height);
    return height;
}

float NativeBoardgameHost::dpiScale() const {
    const int windowWidthValue = windowWidth();
    return windowWidthValue > 0 ? static_cast<float>(pixelWidth()) / static_cast<float>(windowWidthValue) : 1.0f;
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
    return static_cast<int32_t>(SDL_GetTicks());
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
        pixelWidth(),
        pixelHeight()
    );
}

void NativeBoardgameHost::close() {
    if (impl_ == nullptr) {
        return;
    }

    impl_->open = false;
    impl_->textures.reset();

    if (impl_->metalView != nullptr) {
        SDL_Metal_DestroyView(impl_->metalView);
        impl_->metalView = nullptr;
        impl_->layer = nil;
    }

    if (impl_->window != nullptr) {
        SDL_DestroyWindow(impl_->window);
        impl_->window = nullptr;
    }

    if (impl_->sdlOwned) {
        SDL_Quit();
        impl_->sdlOwned = false;
    }
}

} // namespace doof_boardgame_host