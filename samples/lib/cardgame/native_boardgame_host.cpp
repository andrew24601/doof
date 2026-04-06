#include "native_boardgame_host.hpp"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <wincodec.h>
#endif

namespace doof_boardgame_host {
namespace {

struct TextureSlot {
    SDL_Texture* texture = nullptr;
};

#if defined(_WIN32)
constexpr int WINDOWS_SUPERSAMPLE_SCALE = 2;
#endif

std::string resolveAssetBasePath() {
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

float clampAlpha(float alpha) {
    return std::clamp(alpha, 0.0f, 1.0f);
}

float ndcToScreenX(float value, int pixelWidth) {
    return (value * 0.5f + 0.5f) * static_cast<float>(pixelWidth);
}

float ndcToScreenY(float value, int pixelHeight) {
    return (0.5f - value * 0.5f) * static_cast<float>(pixelHeight);
}

bool hasVaryingVertexHeights(const std::shared_ptr<std::vector<std::shared_ptr<RenderVertex>>>& vertices) {
    if (vertices == nullptr || vertices->empty()) {
        return false;
    }

    const float baseline = (*vertices)[0] != nullptr ? (*vertices)[0]->y : 0.0f;
    for (const auto& vertex : *vertices) {
        if (vertex != nullptr && std::fabs(vertex->y - baseline) > 0.001f) {
            return true;
        }
    }

    return false;
}

bool isAnimatedCardBatch(const std::shared_ptr<std::vector<std::shared_ptr<RenderVertex>>>& vertices) {
    // The macOS renderer only enables back-face culling on the world pass. The
    // only world geometry that actually needs it here is the generated flip
    // faces: one quad per face, emitted as exactly two triangles.
    return vertices != nullptr && vertices->size() == 6 && hasVaryingVertexHeights(vertices);
}

float signedTriangleArea(const SDL_Vertex& a, const SDL_Vertex& b, const SDL_Vertex& c) {
    return (b.position.x - a.position.x) * (c.position.y - a.position.y)
        - (b.position.y - a.position.y) * (c.position.x - a.position.x);
}

bool shouldCullAnimatedBatch(const std::vector<SDL_Vertex>& vertices) {
    constexpr float epsilon = 0.001f;

    for (size_t index = 0; index + 2 < vertices.size(); index += 3) {
        const float area = signedTriangleArea(vertices[index], vertices[index + 1], vertices[index + 2]);
        if (std::fabs(area) <= epsilon) {
            continue;
        }

        // In our screen-space coordinates (with Y increasing downward), the
        // visible face for the animated card batches ends up clockwise.
        return area > 0.0f;
    }

    // Edge-on quads collapse to nearly zero area, so skip them instead of
    // drawing both faces on top of each other.
    return true;
}

#if defined(_WIN32)
template <typename T>
void safeRelease(T*& value) {
    if (value != nullptr) {
        value->Release();
        value = nullptr;
    }
}

std::wstring utf8ToWide(const std::string& input) {
    if (input.empty()) {
        return std::wstring();
    }

    const int size = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, nullptr, 0);
    if (size <= 0) {
        return std::wstring();
    }

    std::wstring wide(static_cast<size_t>(size), L'\0');
    const int converted = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, wide.data(), size);
    if (converted <= 0) {
        return std::wstring();
    }

    wide.resize(static_cast<size_t>(converted - 1));
    return wide;
}

SDL_Surface* loadSurfaceFromPath(const std::string& path) {
    const std::wstring widePath = utf8ToWide(path);
    if (widePath.empty()) {
        return nullptr;
    }

    IWICImagingFactory* factory = nullptr;
    IWICBitmapDecoder* decoder = nullptr;
    IWICBitmapFrameDecode* frame = nullptr;
    IWICFormatConverter* converter = nullptr;
    SDL_Surface* surface = nullptr;

    HRESULT hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&factory)
    );
    if (FAILED(hr)) {
        return nullptr;
    }

    hr = factory->CreateDecoderFromFilename(
        widePath.c_str(),
        nullptr,
        GENERIC_READ,
        WICDecodeMetadataCacheOnDemand,
        &decoder
    );
    if (FAILED(hr)) {
        safeRelease(factory);
        return nullptr;
    }

    hr = decoder->GetFrame(0, &frame);
    if (FAILED(hr)) {
        safeRelease(decoder);
        safeRelease(factory);
        return nullptr;
    }

    hr = factory->CreateFormatConverter(&converter);
    if (FAILED(hr)) {
        safeRelease(frame);
        safeRelease(decoder);
        safeRelease(factory);
        return nullptr;
    }

    hr = converter->Initialize(
        frame,
        GUID_WICPixelFormat32bppRGBA,
        WICBitmapDitherTypeNone,
        nullptr,
        0.0,
        WICBitmapPaletteTypeCustom
    );
    if (FAILED(hr)) {
        safeRelease(converter);
        safeRelease(frame);
        safeRelease(decoder);
        safeRelease(factory);
        return nullptr;
    }

    UINT width = 0;
    UINT height = 0;
    hr = converter->GetSize(&width, &height);
    if (FAILED(hr) || width == 0 || height == 0) {
        safeRelease(converter);
        safeRelease(frame);
        safeRelease(decoder);
        safeRelease(factory);
        return nullptr;
    }

    // WIC gives us RGBA bytes in memory order; SDL_PIXELFORMAT_RGBA32 is the
    // byte-order-safe alias that matches those bytes on the current platform.
    surface = SDL_CreateSurface(static_cast<int>(width), static_cast<int>(height), SDL_PIXELFORMAT_RGBA32);
    if (surface == nullptr) {
        safeRelease(converter);
        safeRelease(frame);
        safeRelease(decoder);
        safeRelease(factory);
        return nullptr;
    }

    hr = converter->CopyPixels(
        nullptr,
        static_cast<UINT>(surface->pitch),
        static_cast<UINT>(surface->pitch * surface->h),
        static_cast<BYTE*>(surface->pixels)
    );
    if (FAILED(hr)) {
        SDL_DestroySurface(surface);
        surface = nullptr;
    }

    safeRelease(converter);
    safeRelease(frame);
    safeRelease(decoder);
    safeRelease(factory);
    return surface;
}
#endif

SDL_Texture* createTextureFromSurface(SDL_Renderer* renderer, SDL_Surface* surface) {
    if (renderer == nullptr || surface == nullptr) {
        return nullptr;
    }

    SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer, surface);
    if (texture != nullptr) {
        SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
        SDL_SetTextureScaleMode(texture, SDL_SCALEMODE_LINEAR);
    }
    return texture;
}

SDL_Texture* getTexture(const std::vector<TextureSlot>& textures, int32_t textureId) {
    if (textureId < 0 || static_cast<size_t>(textureId) >= textures.size()) {
        return nullptr;
    }
    return textures[static_cast<size_t>(textureId)].texture;
}

void renderPlan(
    SDL_Renderer* renderer,
    const std::vector<TextureSlot>& textures,
    const std::shared_ptr<WorldRenderPlan>& plan,
    const std::shared_ptr<doof_boardgame::Mat4>& mvp,
    int pixelWidth,
    int pixelHeight
) {
    if (renderer == nullptr || plan == nullptr || plan->draws == nullptr || mvp == nullptr) {
        return;
    }

    for (const auto& draw : *plan->draws) {
        if (draw == nullptr || draw->textureId < 0 || draw->vertices == nullptr || draw->vertices->empty()) {
            continue;
        }

        SDL_Texture* texture = getTexture(textures, draw->textureId);
        if (texture == nullptr) {
            continue;
        }

        std::vector<SDL_Vertex> vertices;
        vertices.reserve(draw->vertices->size());

        for (const auto& rv : *draw->vertices) {
            if (rv == nullptr) {
                continue;
            }

            SDL_Vertex vertex{};
            vertex.position.x = ndcToScreenX(mvp->projectX(rv->x, rv->y, rv->z), pixelWidth);
            vertex.position.y = ndcToScreenY(mvp->projectY(rv->x, rv->y, rv->z), pixelHeight);
            vertex.color.r = 1.0f;
            vertex.color.g = 1.0f;
            vertex.color.b = 1.0f;
            vertex.color.a = clampAlpha(rv->alpha);
            vertex.tex_coord.x = rv->u;
            vertex.tex_coord.y = rv->v;
            vertices.push_back(vertex);
        }

        if (vertices.size() < 3) {
            continue;
        }

        if (isAnimatedCardBatch(draw->vertices) && shouldCullAnimatedBatch(vertices)) {
            continue;
        }

        if (!SDL_RenderGeometry(renderer, texture, vertices.data(), static_cast<int>(vertices.size()), nullptr, 0)) {
            std::fprintf(stderr, "SDL_RenderGeometry failed: %s\n", SDL_GetError());
        }
    }
}

} // anonymous namespace

struct NativeBoardgameHost::Impl {
    SDL_Window* window = nullptr;
    SDL_Renderer* renderer = nullptr;
    std::vector<TextureSlot> textures;
#if defined(_WIN32)
    SDL_Texture* sceneTexture = nullptr;
    int sceneTextureWidth = 0;
    int sceneTextureHeight = 0;
#endif
    bool sdlOwned = false;
    bool open = true;
    Uint64 lastTicks = 0;
    float frameDeltaSeconds = 0.0f;
    std::string assetBasePath;
#if defined(_WIN32)
    bool comInitialized = false;
#endif
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

#if defined(_WIN32)
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure("CoInitializeEx failed");
    }
    impl->comInitialized = (comResult == S_OK || comResult == S_FALSE);
#endif

    impl->window = SDL_CreateWindow(
        title.c_str(),
        width,
        height,
        SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY
    );
    if (impl->window == nullptr) {
        const std::string error = SDL_GetError();
#if defined(_WIN32)
        if (impl->comInitialized) {
            CoUninitialize();
        }
#endif
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(error);
    }

    impl->renderer = SDL_CreateRenderer(impl->window, nullptr);
    if (impl->renderer == nullptr) {
        const std::string error = SDL_GetError();
        SDL_DestroyWindow(impl->window);
#if defined(_WIN32)
        if (impl->comInitialized) {
            CoUninitialize();
        }
#endif
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string>::failure(error);
    }

    SDL_SetRenderVSync(impl->renderer, 1);
    SDL_SetRenderDrawBlendMode(impl->renderer, SDL_BLENDMODE_BLEND);

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
                const bool hasPrimaryShortcutModifier = (event.key.mod & (SDL_KMOD_GUI | SDL_KMOD_CTRL)) != 0;
                if (hasPrimaryShortcutModifier) {
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
    if (impl_ == nullptr || impl_->renderer == nullptr || textureId < 0) {
        return false;
    }

    std::filesystem::path resolved(path);
    if (resolved.is_relative()) {
        resolved = std::filesystem::current_path() / resolved;
    }
    resolved = resolved.lexically_normal();

#if defined(_WIN32)
    SDL_Surface* surface = loadSurfaceFromPath(resolved.string());
#else
    SDL_Surface* surface = nullptr;
#endif
    if (surface == nullptr) {
        std::fprintf(stderr, "Failed to load texture '%s'\n", resolved.string().c_str());
        return false;
    }

    SDL_Texture* texture = createTextureFromSurface(impl_->renderer, surface);
    SDL_DestroySurface(surface);
    if (texture == nullptr) {
        std::fprintf(stderr, "Failed to create texture '%s': %s\n", resolved.string().c_str(), SDL_GetError());
        return false;
    }

    if (static_cast<size_t>(textureId) >= impl_->textures.size()) {
        impl_->textures.resize(static_cast<size_t>(textureId) + 1);
    }

    if (impl_->textures[static_cast<size_t>(textureId)].texture != nullptr) {
        SDL_DestroyTexture(impl_->textures[static_cast<size_t>(textureId)].texture);
    }

    impl_->textures[static_cast<size_t>(textureId)].texture = texture;
    return true;
}

int32_t NativeBoardgameHost::createSolidColorTexture(int32_t r, int32_t g, int32_t b, int32_t a) {
    if (impl_ == nullptr || impl_->renderer == nullptr) {
        return -1;
    }

    SDL_Surface* surface = SDL_CreateSurface(1, 1, SDL_PIXELFORMAT_RGBA32);
    if (surface == nullptr) {
        return -1;
    }

    auto* pixels = static_cast<Uint8*>(surface->pixels);
    pixels[0] = static_cast<Uint8>(r);
    pixels[1] = static_cast<Uint8>(g);
    pixels[2] = static_cast<Uint8>(b);
    pixels[3] = static_cast<Uint8>(a);

    SDL_Texture* texture = createTextureFromSurface(impl_->renderer, surface);
    SDL_DestroySurface(surface);
    if (texture == nullptr) {
        return -1;
    }

    const int32_t textureId = static_cast<int32_t>(impl_->textures.size());
    impl_->textures.push_back(TextureSlot { texture });
    return textureId;
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
    if (impl_ == nullptr || !impl_->open || impl_->renderer == nullptr || world == nullptr || ui == nullptr || worldMvp == nullptr || uiMvp == nullptr) {
        return;
    }

    int renderWidth = pixelWidth();
    int renderHeight = pixelHeight();

#if defined(_WIN32)
    const int targetWidth = std::max(renderWidth * WINDOWS_SUPERSAMPLE_SCALE, 1);
    const int targetHeight = std::max(renderHeight * WINDOWS_SUPERSAMPLE_SCALE, 1);
    bool useSupersampledTarget = false;

    if (impl_->sceneTexture != nullptr
        && (impl_->sceneTextureWidth != targetWidth
            || impl_->sceneTextureHeight != targetHeight)) {
        SDL_DestroyTexture(impl_->sceneTexture);
        impl_->sceneTexture = nullptr;
        impl_->sceneTextureWidth = 0;
        impl_->sceneTextureHeight = 0;
    }

    if (impl_->sceneTexture == nullptr) {
        impl_->sceneTexture = SDL_CreateTexture(
            impl_->renderer,
            SDL_PIXELFORMAT_RGBA32,
            SDL_TEXTUREACCESS_TARGET,
            targetWidth,
            targetHeight
        );

        if (impl_->sceneTexture != nullptr) {
            SDL_SetTextureBlendMode(impl_->sceneTexture, SDL_BLENDMODE_NONE);
            SDL_SetTextureScaleMode(impl_->sceneTexture, SDL_SCALEMODE_LINEAR);
            impl_->sceneTextureWidth = targetWidth;
            impl_->sceneTextureHeight = targetHeight;
        } else {
            std::fprintf(stderr, "Failed to create supersampled render target: %s\n", SDL_GetError());
        }
    }

    useSupersampledTarget = impl_->sceneTexture != nullptr;
    if (useSupersampledTarget) {
        renderWidth = impl_->sceneTextureWidth;
        renderHeight = impl_->sceneTextureHeight;
        SDL_SetRenderTarget(impl_->renderer, impl_->sceneTexture);
    }
#endif

    SDL_SetRenderDrawColor(impl_->renderer, 38, 64, 38, 255);
    SDL_RenderClear(impl_->renderer);

    renderPlan(impl_->renderer, impl_->textures, world, worldMvp, renderWidth, renderHeight);
    renderPlan(impl_->renderer, impl_->textures, ui, uiMvp, renderWidth, renderHeight);

#if defined(_WIN32)
    if (useSupersampledTarget) {
        SDL_SetRenderTarget(impl_->renderer, nullptr);
        SDL_SetRenderDrawColor(impl_->renderer, 38, 64, 38, 255);
        SDL_RenderClear(impl_->renderer);
        SDL_RenderTexture(impl_->renderer, impl_->sceneTexture, nullptr, nullptr);
    }
#endif

    SDL_RenderPresent(impl_->renderer);
}

void NativeBoardgameHost::close() {
    if (impl_ == nullptr) {
        return;
    }

    impl_->open = false;

    for (auto& slot : impl_->textures) {
        if (slot.texture != nullptr) {
            SDL_DestroyTexture(slot.texture);
            slot.texture = nullptr;
        }
    }
    impl_->textures.clear();

#if defined(_WIN32)
    if (impl_->sceneTexture != nullptr) {
        SDL_DestroyTexture(impl_->sceneTexture);
        impl_->sceneTexture = nullptr;
    }
    impl_->sceneTextureWidth = 0;
    impl_->sceneTextureHeight = 0;
#endif

    if (impl_->renderer != nullptr) {
        SDL_DestroyRenderer(impl_->renderer);
        impl_->renderer = nullptr;
    }

    if (impl_->window != nullptr) {
        SDL_DestroyWindow(impl_->window);
        impl_->window = nullptr;
    }

#if defined(_WIN32)
    if (impl_->comInitialized) {
        CoUninitialize();
        impl_->comInitialized = false;
    }
#endif

    if (impl_->sdlOwned) {
        SDL_Quit();
        impl_->sdlOwned = false;
    }
}

} // namespace doof_boardgame_host