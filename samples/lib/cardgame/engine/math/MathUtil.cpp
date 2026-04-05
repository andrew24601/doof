#include "MathUtil.h"

#include <cmath>

simd_float4x4 make_perspective(float fovyRadians, float aspect, float nearZ, float farZ) {
    float ys = 1.0f / tanf(fovyRadians * 0.5f);
    float xs = ys / aspect;
    float zs = farZ / (nearZ - farZ);
    simd_float4x4 m = { { {xs, 0, 0, 0}, {0, ys, 0, 0}, {0, 0, zs, -1}, {0, 0, zs * nearZ, 0} } };
    return m;
}

simd_float4x4 make_look_at(simd_float3 eye, simd_float3 center, simd_float3 up) {
    simd_float3 f = simd_normalize(center - eye);
    simd_float3 s = simd_normalize(simd_cross(f, up));
    simd_float3 u = simd_cross(s, f);

    simd_float4 col0 = { s.x, u.x, -f.x, 0.0f };
    simd_float4 col1 = { s.y, u.y, -f.y, 0.0f };
    simd_float4 col2 = { s.z, u.z, -f.z, 0.0f };
    simd_float4 col3 = { -simd_dot(s, eye), -simd_dot(u, eye), simd_dot(f, eye), 1.0f };

    simd_float4x4 m = { col0, col1, col2, col3 };
    return m;
}

simd_float4x4 make_ortho(float left, float right, float bottom, float top, float nearZ, float farZ) {
    float sx = 2.0f / (right - left);
    float sy = 2.0f / (top - bottom);
    float sz = 1.0f / (nearZ - farZ);
    float tx = -(right + left) / (right - left);
    float ty = -(top + bottom) / (top - bottom);
    float tz = nearZ / (nearZ - farZ);
    simd_float4x4 m = { { {sx, 0, 0, 0}, {0, sy, 0, 0}, {0, 0, sz, 0}, {tx, ty, tz, 1} } };
    return m;
}
