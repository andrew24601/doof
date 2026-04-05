#pragma once

#include <memory>
#include <algorithm>
#include <array>
#include <cmath>

namespace doof_boardgame {
namespace detail {

inline float& element(std::array<float, 16>& values, int row, int column) {
    return values[static_cast<size_t>(column) * 4 + static_cast<size_t>(row)];
}

inline float element(const std::array<float, 16>& values, int row, int column) {
    return values[static_cast<size_t>(column) * 4 + static_cast<size_t>(row)];
}

inline std::array<float, 16> identityMatrix() {
    return {
        1.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 1.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 1.0f, 0.0f,
        0.0f, 0.0f, 0.0f, 1.0f,
    };
}

inline std::array<float, 16> multiplyMatrices(const std::array<float, 16>& left, const std::array<float, 16>& right) {
    std::array<float, 16> result{};
    for (int row = 0; row < 4; row += 1) {
        for (int column = 0; column < 4; column += 1) {
            float sum = 0.0f;
            for (int pivot = 0; pivot < 4; pivot += 1) {
                sum += element(left, row, pivot) * element(right, pivot, column);
            }
            element(result, row, column) = sum;
        }
    }
    return result;
}

inline std::array<float, 4> multiplyVector(const std::array<float, 16>& matrix, float x, float y, float z, float w) {
    return {
        element(matrix, 0, 0) * x + element(matrix, 0, 1) * y + element(matrix, 0, 2) * z + element(matrix, 0, 3) * w,
        element(matrix, 1, 0) * x + element(matrix, 1, 1) * y + element(matrix, 1, 2) * z + element(matrix, 1, 3) * w,
        element(matrix, 2, 0) * x + element(matrix, 2, 1) * y + element(matrix, 2, 2) * z + element(matrix, 2, 3) * w,
        element(matrix, 3, 0) * x + element(matrix, 3, 1) * y + element(matrix, 3, 2) * z + element(matrix, 3, 3) * w,
    };
}

inline std::array<float, 3> subtractVec3(const std::array<float, 3>& left, const std::array<float, 3>& right) {
    return {left[0] - right[0], left[1] - right[1], left[2] - right[2]};
}

inline float dotVec3(const std::array<float, 3>& left, const std::array<float, 3>& right) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

inline std::array<float, 3> crossVec3(const std::array<float, 3>& left, const std::array<float, 3>& right) {
    return {
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    };
}

inline std::array<float, 3> normalizeVec3(const std::array<float, 3>& value) {
    const float lengthSquared = dotVec3(value, value);
    if (lengthSquared <= 0.0000001f) {
        return {0.0f, 0.0f, 0.0f};
    }

    const float inverseLength = 1.0f / std::sqrt(lengthSquared);
    return {value[0] * inverseLength, value[1] * inverseLength, value[2] * inverseLength};
}

inline std::array<float, 16> inverseMatrix(const std::array<float, 16>& matrix) {
    float augmented[4][8] = {};
    for (int row = 0; row < 4; row += 1) {
        for (int column = 0; column < 4; column += 1) {
            augmented[row][column] = element(matrix, row, column);
        }
        augmented[row][row + 4] = 1.0f;
    }

    for (int pivot = 0; pivot < 4; pivot += 1) {
        int bestRow = pivot;
        float bestValue = std::fabs(augmented[pivot][pivot]);
        for (int candidate = pivot + 1; candidate < 4; candidate += 1) {
            const float value = std::fabs(augmented[candidate][pivot]);
            if (value > bestValue) {
                bestValue = value;
                bestRow = candidate;
            }
        }

        if (bestValue <= 0.0000001f) {
            return identityMatrix();
        }

        if (bestRow != pivot) {
            for (int column = 0; column < 8; column += 1) {
                std::swap(augmented[pivot][column], augmented[bestRow][column]);
            }
        }

        const float pivotValue = augmented[pivot][pivot];
        for (int column = 0; column < 8; column += 1) {
            augmented[pivot][column] /= pivotValue;
        }

        for (int row = 0; row < 4; row += 1) {
            if (row == pivot) {
                continue;
            }

            const float factor = augmented[row][pivot];
            if (std::fabs(factor) <= 0.0000001f) {
                continue;
            }

            for (int column = 0; column < 8; column += 1) {
                augmented[row][column] -= factor * augmented[pivot][column];
            }
        }
    }

    std::array<float, 16> result{};
    for (int row = 0; row < 4; row += 1) {
        for (int column = 0; column < 4; column += 1) {
            element(result, row, column) = augmented[row][column + 4];
        }
    }
    return result;
}

} // namespace detail

struct Mat4 {
    std::array<float, 16> m = detail::identityMatrix();

    static std::shared_ptr<Mat4> perspective(float fovY, float aspect, float nearZ, float farZ) {
        auto result = std::make_shared<Mat4>();
        result->m.fill(0.0f);

        const float ys = 1.0f / std::tan(fovY * 0.5f);
        const float xs = ys / aspect;
        const float zs = farZ / (nearZ - farZ);

        detail::element(result->m, 0, 0) = xs;
        detail::element(result->m, 1, 1) = ys;
        detail::element(result->m, 2, 2) = zs;
        detail::element(result->m, 2, 3) = zs * nearZ;
        detail::element(result->m, 3, 2) = -1.0f;
        return result;
    }

    static std::shared_ptr<Mat4> lookAt(float eyeX, float eyeY, float eyeZ,
                                        float tarX, float tarY, float tarZ) {
        auto result = std::make_shared<Mat4>();

        const std::array<float, 3> eye = {eyeX, eyeY, eyeZ};
        const std::array<float, 3> target = {tarX, tarY, tarZ};
        const std::array<float, 3> up = {0.0f, 1.0f, 0.0f};

        const std::array<float, 3> forward = detail::normalizeVec3(detail::subtractVec3(target, eye));
        const std::array<float, 3> side = detail::normalizeVec3(detail::crossVec3(forward, up));
        const std::array<float, 3> actualUp = detail::crossVec3(side, forward);

        result->m = {
            side[0], actualUp[0], -forward[0], 0.0f,
            side[1], actualUp[1], -forward[1], 0.0f,
            side[2], actualUp[2], -forward[2], 0.0f,
            -detail::dotVec3(side, eye), -detail::dotVec3(actualUp, eye), detail::dotVec3(forward, eye), 1.0f,
        };
        return result;
    }

    static std::shared_ptr<Mat4> ortho(float left, float right, float bottom, float top,
                                       float nearZ, float farZ) {
        auto result = std::make_shared<Mat4>();
        result->m.fill(0.0f);

        const float sx = 2.0f / (right - left);
        const float sy = 2.0f / (top - bottom);
        const float sz = 1.0f / (nearZ - farZ);
        const float tx = -(right + left) / (right - left);
        const float ty = -(top + bottom) / (top - bottom);
        const float tz = nearZ / (nearZ - farZ);

        detail::element(result->m, 0, 0) = sx;
        detail::element(result->m, 1, 1) = sy;
        detail::element(result->m, 2, 2) = sz;
        detail::element(result->m, 0, 3) = tx;
        detail::element(result->m, 1, 3) = ty;
        detail::element(result->m, 2, 3) = tz;
        detail::element(result->m, 3, 3) = 1.0f;
        return result;
    }

    static std::shared_ptr<Mat4> multiply(std::shared_ptr<Mat4> a, std::shared_ptr<Mat4> b) {
        auto result = std::make_shared<Mat4>();
        result->m = detail::multiplyMatrices(a->m, b->m);
        return result;
    }

    static std::shared_ptr<Mat4> inverse(std::shared_ptr<Mat4> a) {
        auto result = std::make_shared<Mat4>();
        result->m = detail::inverseMatrix(a->m);
        return result;
    }

    static std::shared_ptr<Mat4> frameTransform(float scale, float panX, float panY) {
        auto result = std::make_shared<Mat4>();
        result->m = {
            scale, 0.0f, 0.0f, 0.0f,
            0.0f, scale, 0.0f, 0.0f,
            0.0f, 0.0f, 1.0f, 0.0f,
            panX, panY, 0.0f, 1.0f,
        };
        return result;
    }

    float projectX(float x, float y, float z) {
        const std::array<float, 4> clip = detail::multiplyVector(m, x, y, z, 1.0f);
        if (clip[3] <= 0.0001f) return 0.0f;
        return clip[0] / clip[3];
    }

    float projectY(float x, float y, float z) {
        const std::array<float, 4> clip = detail::multiplyVector(m, x, y, z, 1.0f);
        if (clip[3] <= 0.0001f) return 0.0f;
        return clip[1] / clip[3];
    }

    float projectZ(float x, float y, float z) {
        const std::array<float, 4> clip = detail::multiplyVector(m, x, y, z, 1.0f);
        if (clip[3] <= 0.0001f) return 0.0f;
        return clip[2] / clip[3];
    }
};

} // namespace doof_boardgame
