#pragma once
#include "value.h"
#include <variant>
#include <memory>

// Forward declarations
class ArrayIterator;
class SetIterator;
class MapIterator;
class IntSetIterator;
class IntMapIterator;

// Iterator value type for VM registers
class Iterator {
public:
    enum class Type {
        Array,
        Set,
        Map,
        IntSet,
        IntMap
    };

    using Storage = std::variant<
        std::unique_ptr<ArrayIterator>,
        std::unique_ptr<SetIterator>,
        std::unique_ptr<MapIterator>,
        std::unique_ptr<IntSetIterator>,
        std::unique_ptr<IntMapIterator>
    >;

    Iterator(std::unique_ptr<ArrayIterator> iter);
    Iterator(std::unique_ptr<SetIterator> iter);
    Iterator(std::unique_ptr<MapIterator> iter);
    Iterator(std::unique_ptr<IntSetIterator> iter);
    Iterator(std::unique_ptr<IntMapIterator> iter);

    // Move-only semantics
    Iterator(const Iterator&) = delete;
    Iterator& operator=(const Iterator&) = delete;
    Iterator(Iterator&&) = default;
    Iterator& operator=(Iterator&&) = default;

    Type type() const;
    bool has_next();
    Value get_value();
    Value get_key(); // For map iterators only
    void advance();

private:
    Storage storage_;
    Type type_;
};

// Array iterator implementation
class ArrayIterator {
public:
    ArrayIterator(const ArrayPtr& array);
    bool has_next() const;
    Value get_value() const;
    void advance();

private:
    ArrayPtr array_;
    size_t index_;
};

// Set iterator implementation (string values)
class SetIterator {
public:
    SetIterator(const SetPtr& set);
    bool has_next() const;
    Value get_value() const;
    void advance();

private:
    SetPtr set_;
    Set::const_iterator current_;
    Set::const_iterator end_;
};

// Map iterator implementation (string keys)
class MapIterator {
public:
    MapIterator(const MapPtr& map);
    bool has_next() const;
    Value get_value() const;
    Value get_key() const;
    void advance();

private:
    MapPtr map_;
    Map::const_iterator current_;
    Map::const_iterator end_;
};

// Integer set iterator implementation
class IntSetIterator {
public:
    IntSetIterator(const IntSetPtr& set);
    bool has_next() const;
    Value get_value() const;
    void advance();

private:
    IntSetPtr set_;
    IntSet::const_iterator current_;
    IntSet::const_iterator end_;
};

// Integer map iterator implementation
class IntMapIterator {
public:
    IntMapIterator(const IntMapPtr& map);
    bool has_next() const;
    Value get_value() const;
    Value get_key() const;
    void advance();

private:
    IntMapPtr map_;
    IntMap::const_iterator current_;
    IntMap::const_iterator end_;
};

using IteratorPtr = std::shared_ptr<Iterator>;
