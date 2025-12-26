#include "arrays.h"
#include "doof_runtime.h"

namespace integration::test_data::arrays {

    Point::Point() {
    }

    Point::Point(int x, int y) {
        this->x = x;
        this->y = y;
    }


    int main() {
    #line 26 "integration/test-data/arrays.do"
        std::string result = "";
    #line 27 "integration/test-data/arrays.do"
        std::shared_ptr<std::vector<int>> numbers = std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2, 3, 4, 5});
    #line 28 "integration/test-data/arrays.do"
        std::shared_ptr<std::vector<std::string>> strings = std::make_shared<std::vector<std::string>>(std::initializer_list<std::string>{"hello", "world"});
    #line 30 "integration/test-data/arrays.do"
        result = ((result + std::to_string(numbers->at(0))) + std::string("|"));
    #line 31 "integration/test-data/arrays.do"
        result = ((result + std::to_string(numbers->at((numbers->size() - 1)))) + std::string("|"));
    #line 32 "integration/test-data/arrays.do"
        numbers->push_back(6);
    #line 33 "integration/test-data/arrays.do"
        result = ((result + std::to_string(numbers->size())) + std::string("|"));
        int popped = doof_runtime::array_pop(*numbers);
    #line 35 "integration/test-data/arrays.do"
        result = ((result + std::to_string(popped)) + std::string("|"));
        int sum = 0;
    #line 39 "integration/test-data/arrays.do"
        for (int i = 0; (i < numbers->size()); (i++)) {
    #line 38 "integration/test-data/arrays.do"
            sum = (sum + numbers->at(i));
        }
    #line 40 "integration/test-data/arrays.do"
        result = ((result + std::to_string(sum)) + std::string("|"));
        int product = 1;
    #line 44 "integration/test-data/arrays.do"
        for (const auto& num : *numbers) {
    #line 43 "integration/test-data/arrays.do"
            product = (product * num);
        }
    #line 45 "integration/test-data/arrays.do"
        result = ((result + std::to_string(product)) + std::string("|"));
        std::shared_ptr<std::vector<std::shared_ptr<std::vector<int>>>> matrix = std::make_shared<std::vector<std::shared_ptr<std::vector<int>>>>(std::initializer_list<std::shared_ptr<std::vector<int>>>{std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2}), std::make_shared<std::vector<int>>(std::initializer_list<int>{3, 4})});
    #line 47 "integration/test-data/arrays.do"
        result = ((result + std::to_string(matrix->at(1)->at(0))) + std::string("|"));
        std::shared_ptr<std::vector<std::shared_ptr<Point>>> coords = std::make_shared<std::vector<std::shared_ptr<Point>>>(std::initializer_list<std::shared_ptr<Point>>{std::make_shared<Point>(1, 2), std::make_shared<Point>(3, 4)});
    #line 49 "integration/test-data/arrays.do"
        result = ((result + std::to_string(coords->at(0)->x)) + std::to_string(coords->at(1)->y));
    #line 50 "integration/test-data/arrays.do"
        std::cout << result << std::endl;
    #line 51 "integration/test-data/arrays.do"
        return 0;
    }


} // namespace integration::test_data::arrays


int main() {
    return integration::test_data::arrays::main();
}
