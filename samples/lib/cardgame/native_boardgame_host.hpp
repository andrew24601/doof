#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "doof_runtime.hpp"
#include "lib/cardgame/types.hpp"
#include "lib/cardgame/matrix.hpp"
#include "lib/cardgame/render-plan.hpp"

namespace doof_boardgame_host {

class NativeBoardgameEvent {
public:
    NativeBoardgameEvent(
        NativeBoardgameEventKind kind,
        float x = 0.0f,
        float y = 0.0f,
        float wheelY = 0.0f,
        NativeBoardgameKey key = NativeBoardgameKey::Unknown
    );

    NativeBoardgameEventKind kind() const;
    float x() const;
    float y() const;
    float wheelY() const;
    NativeBoardgameKey key() const;

private:
    NativeBoardgameEventKind kind_;
    float x_;
    float y_;
    float wheelY_;
    NativeBoardgameKey key_;
};

class NativeBoardgameHost {
public:
    static doof::Result<std::shared_ptr<NativeBoardgameHost>, std::string> create(
        const std::string& title,
        int32_t width,
        int32_t height
    );

    ~NativeBoardgameHost();

    bool isOpen() const;
    std::shared_ptr<std::vector<std::shared_ptr<NativeBoardgameEvent>>> pollEvents(bool canNap);
    float frameDeltaSeconds() const;
    int32_t windowWidth() const;
    int32_t windowHeight() const;
    int32_t pixelWidth() const;
    int32_t pixelHeight() const;
    float dpiScale() const;
    std::string assetBasePath() const;
    bool loadTextureWithId(int32_t textureId, const std::string& path);
    int32_t createSolidColorTexture(int32_t r, int32_t g, int32_t b, int32_t a);
    int32_t ticks() const;
    void render(
        std::shared_ptr<WorldRenderPlan> world,
        std::shared_ptr<doof_boardgame::Mat4> worldMvp,
        std::shared_ptr<WorldRenderPlan> ui,
        std::shared_ptr<doof_boardgame::Mat4> uiMvp
    );
    void close();

private:
    struct Impl;

    explicit NativeBoardgameHost(std::unique_ptr<Impl> impl);

    std::unique_ptr<Impl> impl_;
};

} // namespace doof_boardgame_host