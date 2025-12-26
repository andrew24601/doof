#ifndef ARRAYS_H
#define ARRAYS_H

#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "doof_runtime.h"
#include "doof_runtime.h"

namespace integration::test_data::arrays {
    class Point;
} // namespace integration::test_data::arrays

namespace integration::test_data::arrays {

    class Point : public std::enable_shared_from_this<Point> {
        public:
            Point();
            Point(int x, int y);
            int x;
            int y;
    };

    int main();


} // namespace integration::test_data::arrays

#endif // ARRAYS_H
