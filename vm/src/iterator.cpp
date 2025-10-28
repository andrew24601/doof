#include "iterator.h"
#include <stdexcept>

// Iterator main class implementation
Iterator::Iterator(std::unique_ptr<ArrayIterator> iter) 
    : storage_(std::move(iter)), type_(Type::Array) {}

Iterator::Iterator(std::unique_ptr<SetIterator> iter) 
    : storage_(std::move(iter)), type_(Type::Set) {}

Iterator::Iterator(std::unique_ptr<MapIterator> iter) 
    : storage_(std::move(iter)), type_(Type::Map) {}

Iterator::Iterator(std::unique_ptr<IntSetIterator> iter) 
    : storage_(std::move(iter)), type_(Type::IntSet) {}

Iterator::Iterator(std::unique_ptr<IntMapIterator> iter) 
    : storage_(std::move(iter)), type_(Type::IntMap) {}

Iterator::Type Iterator::type() const {
    return type_;
}

bool Iterator::has_next() {
    switch (type_) {
        case Type::Array:
            return std::get<std::unique_ptr<ArrayIterator>>(storage_)->has_next();
        case Type::Set:
            return std::get<std::unique_ptr<SetIterator>>(storage_)->has_next();
        case Type::Map:
            return std::get<std::unique_ptr<MapIterator>>(storage_)->has_next();
        case Type::IntSet:
            return std::get<std::unique_ptr<IntSetIterator>>(storage_)->has_next();
        case Type::IntMap:
            return std::get<std::unique_ptr<IntMapIterator>>(storage_)->has_next();
        default:
            throw std::runtime_error("Invalid iterator type");
    }
}

Value Iterator::get_value() {
    switch (type_) {
        case Type::Array:
            return std::get<std::unique_ptr<ArrayIterator>>(storage_)->get_value();
        case Type::Set:
            return std::get<std::unique_ptr<SetIterator>>(storage_)->get_value();
        case Type::Map:
            return std::get<std::unique_ptr<MapIterator>>(storage_)->get_value();
        case Type::IntSet:
            return std::get<std::unique_ptr<IntSetIterator>>(storage_)->get_value();
        case Type::IntMap:
            return std::get<std::unique_ptr<IntMapIterator>>(storage_)->get_value();
        default:
            throw std::runtime_error("Invalid iterator type");
    }
}

Value Iterator::get_key() {
    switch (type_) {
        case Type::Map:
            return std::get<std::unique_ptr<MapIterator>>(storage_)->get_key();
        case Type::IntMap:
            return std::get<std::unique_ptr<IntMapIterator>>(storage_)->get_key();
        default:
            throw std::runtime_error("get_key() only valid for map iterators");
    }
}

void Iterator::advance() {
    switch (type_) {
        case Type::Array:
            std::get<std::unique_ptr<ArrayIterator>>(storage_)->advance();
            break;
        case Type::Set:
            std::get<std::unique_ptr<SetIterator>>(storage_)->advance();
            break;
        case Type::Map:
            std::get<std::unique_ptr<MapIterator>>(storage_)->advance();
            break;
        case Type::IntSet:
            std::get<std::unique_ptr<IntSetIterator>>(storage_)->advance();
            break;
        case Type::IntMap:
            std::get<std::unique_ptr<IntMapIterator>>(storage_)->advance();
            break;
        default:
            throw std::runtime_error("Invalid iterator type");
    }
}

// ArrayIterator implementation
ArrayIterator::ArrayIterator(const ArrayPtr& array) 
    : array_(array), index_(0) {}

bool ArrayIterator::has_next() const {
    return array_ && index_ < array_->size();
}

Value ArrayIterator::get_value() const {
    if (!has_next()) {
        throw std::runtime_error("Array iterator exhausted");
    }
    return (*array_)[index_];
}

void ArrayIterator::advance() {
    if (has_next()) {
        ++index_;
    }
}

// SetIterator implementation
SetIterator::SetIterator(const SetPtr& set) 
    : set_(set), current_(set->begin()), end_(set->end()) {}

bool SetIterator::has_next() const {
    return current_ != end_;
}

Value SetIterator::get_value() const {
    if (!has_next()) {
        throw std::runtime_error("Set iterator exhausted");
    }
    return *current_;
}

void SetIterator::advance() {
    if (has_next()) {
        ++current_;
    }
}

// MapIterator implementation
MapIterator::MapIterator(const MapPtr& map) 
    : map_(map), current_(map->begin()), end_(map->end()) {}

bool MapIterator::has_next() const {
    return current_ != end_;
}

Value MapIterator::get_value() const {
    if (!has_next()) {
        throw std::runtime_error("Map iterator exhausted");
    }
    return current_->second;
}

Value MapIterator::get_key() const {
    if (!has_next()) {
        throw std::runtime_error("Map iterator exhausted");
    }
    return Value::make_string(current_->first);
}

void MapIterator::advance() {
    if (has_next()) {
        ++current_;
    }
}

// IntSetIterator implementation
IntSetIterator::IntSetIterator(const IntSetPtr& set) 
    : set_(set), current_(set->begin()), end_(set->end()) {}

bool IntSetIterator::has_next() const {
    return current_ != end_;
}

Value IntSetIterator::get_value() const {
    if (!has_next()) {
        throw std::runtime_error("Int set iterator exhausted");
    }
    return Value::make_int(*current_);
}

void IntSetIterator::advance() {
    if (has_next()) {
        ++current_;
    }
}

// IntMapIterator implementation
IntMapIterator::IntMapIterator(const IntMapPtr& map) 
    : map_(map), current_(map->begin()), end_(map->end()) {}

bool IntMapIterator::has_next() const {
    return current_ != end_;
}

Value IntMapIterator::get_value() const {
    if (!has_next()) {
        throw std::runtime_error("Int map iterator exhausted");
    }
    return current_->second;
}

Value IntMapIterator::get_key() const {
    if (!has_next()) {
        throw std::runtime_error("Int map iterator exhausted");
    }
    return Value::make_int(current_->first);
}

void IntMapIterator::advance() {
    if (has_next()) {
        ++current_;
    }
}
