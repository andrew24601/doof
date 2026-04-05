#pragma once

#include <memory>

#include <engine/math/MathUtil.h>
#include <simd/simd.h>

namespace doof_boardgame {

struct Mat4 {
    simd_float4x4 m;

    static std::shared_ptr<Mat4> perspective(float fovY, float aspect, float nearZ, float farZ) {
        auto result = std::make_shared<Mat4>();
        result->m = make_perspective(fovY, aspect, nearZ, farZ);
        return result;
    }

    static std::shared_ptr<Mat4> lookAt(float eyeX, float eyeY, float eyeZ,
                                        float tarX, float tarY, float tarZ) {
        auto result = std::make_shared<Mat4>();
        const simd_float3 eye = {eyeX, eyeY, eyeZ};
        const simd_float3 target = {tarX, tarY, tarZ};
        const simd_float3 up = {0.0f, 1.0f, 0.0f};
        result->m = make_look_at(eye, target, up);
        return result;
    }

    static std::shared_ptr<Mat4> ortho(float left, float right, float bottom, float top,
                                       float nearZ, float farZ) {
        auto result = std::make_shared<Mat4>();
        result->m = make_ortho(left, right, bottom, top, nearZ, farZ);
        return result;
    }

    static std::shared_ptr<Mat4> multiply(std::shared_ptr<Mat4> a, std::shared_ptr<Mat4> b) {
        auto result = std::make_shared<Mat4>();
        result->m = simd_mul(a->m, b->m);
        return result;
    }

    static std::shared_ptr<Mat4> inverse(std::shared_ptr<Mat4> a) {
        auto result = std::make_shared<Mat4>();
        result->m = simd_inverse(a->m);
        return result;
    }

    static std::shared_ptr<Mat4> frameTransform(float scale, float panX, float panY) {
        auto result = std::make_shared<Mat4>();
        result->m = (simd_float4x4){{
            {scale, 0.0f, 0.0f, 0.0f},
            {0.0f, scale, 0.0f, 0.0f},
            {0.0f, 0.0f, 1.0f, 0.0f},
            {panX, panY, 0.0f, 1.0f},
        }};
        return result;
    }

    float projectX(float x, float y, float z) {
        const simd_float4 p = {x, y, z, 1.0f};
        const simd_float4 clip = simd_mul(m, p);
        if (clip.w <= 0.0001f) return 0.0f;
        return clip.x / clip.w;
    }

    float projectY(float x, float y, float z) {
        const simd_float4 p = {x, y, z, 1.0f};
        const simd_float4 clip = simd_mul(m, p);
        if (clip.w <= 0.0001f) return 0.0f;
        return clip.y / clip.w;
    }

    float projectZ(float x, float y, float z) {
        const simd_float4 p = {x, y, z, 1.0f};
        const simd_float4 clip = simd_mul(m, p);
        if (clip.w <= 0.0001f) return 0.0f;
        return clip.z / clip.w;
    }
};

} // namespace doof_boardgame