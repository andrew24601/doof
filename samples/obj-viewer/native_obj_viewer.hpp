#pragma once

#include <SDL3/SDL.h>

#include <cstdint>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "doof_runtime.hpp"

namespace doof_obj_viewer {

inline doof::Result<std::string, std::string> readTextFile(const std::string& path) {
    std::ifstream input(path);
    if (!input.is_open()) {
        return doof::Result<std::string, std::string>::failure("could not open file");
    }

    std::ostringstream buffer;
    buffer << input.rdbuf();
    return doof::Result<std::string, std::string>::success(buffer.str());
}

class NativeLineViewer {
public:
    static doof::Result<std::shared_ptr<NativeLineViewer>, std::string> create(
        const std::string& title,
        int32_t width,
        int32_t height
    ) {
        if (!SDL_Init(SDL_INIT_VIDEO)) {
            return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(SDL_GetError());
        }

        SDL_Window* window = SDL_CreateWindow(
            title.c_str(),
            width,
            height,
            SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY
        );
        if (window == nullptr) {
            const std::string error = SDL_GetError();
            SDL_Quit();
            return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(error);
        }

        SDL_Renderer* renderer = SDL_CreateRenderer(window, nullptr);
        if (renderer == nullptr) {
            const std::string error = SDL_GetError();
            SDL_DestroyWindow(window);
            SDL_Quit();
            return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(error);
        }

        SDL_SetRenderVSync(renderer, 1);
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::success(
            std::shared_ptr<NativeLineViewer>(new NativeLineViewer(window, renderer))
        );
    }

    ~NativeLineViewer() {
        close();
    }

    bool isOpen() const {
        return open_;
    }

    void pollEvents() {
        if (!open_) {
            return;
        }

        resetRequested_ = false;

        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            switch (event.type) {
                case SDL_EVENT_QUIT:
                    open_ = false;
                    break;
                case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
                    open_ = false;
                    break;
                case SDL_EVENT_MOUSE_BUTTON_DOWN:
                    if (event.button.button == SDL_BUTTON_LEFT) {
                        leftDown_ = true;
                    } else if (event.button.button == SDL_BUTTON_RIGHT || event.button.button == SDL_BUTTON_MIDDLE) {
                        rightDown_ = true;
                    }
                    break;
                case SDL_EVENT_MOUSE_BUTTON_UP:
                    if (event.button.button == SDL_BUTTON_LEFT) {
                        leftDown_ = false;
                    } else if (event.button.button == SDL_BUTTON_RIGHT || event.button.button == SDL_BUTTON_MIDDLE) {
                        rightDown_ = false;
                    }
                    break;
                case SDL_EVENT_MOUSE_MOTION:
                    if (leftDown_) {
                        orbitX_ += event.motion.xrel * 0.010f;
                        orbitY_ += event.motion.yrel * 0.010f;
                    }
                    if (rightDown_) {
                        panX_ += event.motion.xrel * 0.0025f;
                        panY_ -= event.motion.yrel * 0.0025f;
                    }
                    break;
                case SDL_EVENT_MOUSE_WHEEL:
                    zoom_ += static_cast<float>(event.wheel.y);
                    break;
                case SDL_EVENT_KEY_DOWN:
                    if (event.key.scancode == SDL_SCANCODE_ESCAPE) {
                        open_ = false;
                    } else if (event.key.scancode == SDL_SCANCODE_R) {
                        resetRequested_ = true;
                    }
                    break;
                default:
                    break;
            }
        }
    }

    int32_t width() const {
        int width = 0;
        int height = 0;
        SDL_GetWindowSizeInPixels(window_, &width, &height);
        return width;
    }

    int32_t height() const {
        int width = 0;
        int height = 0;
        SDL_GetWindowSizeInPixels(window_, &width, &height);
        return height;
    }

    void setTitle(const std::string& title) {
        if (window_ != nullptr) {
            SDL_SetWindowTitle(window_, title.c_str());
        }
    }

    void clear(int32_t r, int32_t g, int32_t b) {
        if (renderer_ == nullptr) {
            return;
        }

        SDL_SetRenderDrawColor(renderer_, static_cast<Uint8>(r), static_cast<Uint8>(g), static_cast<Uint8>(b), 255);
        SDL_RenderClear(renderer_);
    }

    void drawLine(float x0, float y0, float x1, float y1, int32_t r, int32_t g, int32_t b) {
        if (renderer_ == nullptr) {
            return;
        }

        SDL_SetRenderDrawColor(renderer_, static_cast<Uint8>(r), static_cast<Uint8>(g), static_cast<Uint8>(b), 255);
        SDL_RenderLine(renderer_, x0, y0, x1, y1);
    }

    void present() {
        if (renderer_ != nullptr) {
            SDL_RenderPresent(renderer_);
        }
    }

    void delay(int32_t ms) {
        SDL_Delay(ms);
    }

    void close() {
        if (renderer_ != nullptr) {
            SDL_DestroyRenderer(renderer_);
            renderer_ = nullptr;
        }
        if (window_ != nullptr) {
            SDL_DestroyWindow(window_);
            window_ = nullptr;
        }
        if (sdlOwned_) {
            SDL_Quit();
            sdlOwned_ = false;
        }
        open_ = false;
    }

    float consumeOrbitX() {
        const float value = orbitX_;
        orbitX_ = 0.0f;
        return value;
    }

    float consumeOrbitY() {
        const float value = orbitY_;
        orbitY_ = 0.0f;
        return value;
    }

    float consumePanX() {
        const float value = panX_;
        panX_ = 0.0f;
        return value;
    }

    float consumePanY() {
        const float value = panY_;
        panY_ = 0.0f;
        return value;
    }

    float consumeZoom() {
        const float value = zoom_;
        zoom_ = 0.0f;
        return value;
    }

    bool consumeResetRequested() {
        const bool value = resetRequested_;
        resetRequested_ = false;
        return value;
    }

private:
    NativeLineViewer(SDL_Window* window, SDL_Renderer* renderer)
        : window_(window), renderer_(renderer), sdlOwned_(true) {}

    SDL_Window* window_;
    SDL_Renderer* renderer_;
    bool sdlOwned_;
    bool open_ = true;
    bool leftDown_ = false;
    bool rightDown_ = false;
    bool resetRequested_ = false;
    float orbitX_ = 0.0f;
    float orbitY_ = 0.0f;
    float panX_ = 0.0f;
    float panY_ = 0.0f;
    float zoom_ = 0.0f;
};

} // namespace doof_obj_viewer