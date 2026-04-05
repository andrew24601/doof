#pragma once

#include <simd/simd.h>

simd_float4x4 make_perspective(float fovyRadians, float aspect, float nearZ, float farZ);
simd_float4x4 make_look_at(simd_float3 eye, simd_float3 center, simd_float3 up);
simd_float4x4 make_ortho(float left, float right, float bottom, float top, float nearZ, float farZ);
