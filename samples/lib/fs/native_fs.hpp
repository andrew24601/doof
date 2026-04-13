#pragma once

#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <system_error>
#include <vector>

#include "doof_runtime.hpp"
#include "types.hpp"

namespace doof_fs {

inline IoError mapIoError(const std::error_code& error) {
    using std::errc;
    switch (static_cast<errc>(error.value())) {
        case errc::no_such_file_or_directory:
            return IoError::NotFound;
        case errc::file_exists:
            return IoError::AlreadyExists;
        case errc::is_a_directory:
            return IoError::IsDirectory;
        case errc::not_a_directory:
            return IoError::NotDirectory;
        case errc::permission_denied:
            return IoError::PermissionDenied;
        case errc::invalid_argument:
            return IoError::InvalidInput;
        default:
            return IoError::Other;
    }
}

inline doof::Result<void, IoError> successVoid() {
    return doof::Result<void, IoError>::success();
}

inline doof::Result<void, IoError> failureVoid(IoError error) {
    return doof::Result<void, IoError>::failure(error);
}

inline bool exists(const std::string& path) {
    std::error_code error;
    return std::filesystem::exists(path, error);
}

inline bool isDirectory(const std::string& path) {
    std::error_code error;
    return std::filesystem::is_directory(path, error);
}

inline bool isFile(const std::string& path) {
    std::error_code error;
    return std::filesystem::is_regular_file(path, error);
}

inline doof::Result<void, IoError> mkdir(const std::string& path) {
    std::error_code error;
    if (std::filesystem::exists(path, error)) {
        return failureVoid(IoError::AlreadyExists);
    }
    if (error) {
        return failureVoid(mapIoError(error));
    }
    if (!std::filesystem::create_directory(path, error)) {
        return failureVoid(error ? mapIoError(error) : IoError::AlreadyExists);
    }
    return successVoid();
}

inline doof::Result<std::string, IoError> readText(const std::string& path) {
    if (!exists(path)) {
        return doof::Result<std::string, IoError>::failure(IoError::NotFound);
    }
    if (isDirectory(path)) {
        return doof::Result<std::string, IoError>::failure(IoError::IsDirectory);
    }

    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) {
        return doof::Result<std::string, IoError>::failure(IoError::Other);
    }

    std::string content((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    return doof::Result<std::string, IoError>::success(content);
}

inline doof::Result<void, IoError> writeText(const std::string& path, const std::string& value) {
    if (isDirectory(path)) {
        return failureVoid(IoError::IsDirectory);
    }

    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) {
        return failureVoid(IoError::Other);
    }
    output << value;
    return successVoid();
}

inline doof::Result<void, IoError> appendText(const std::string& path, const std::string& value) {
    if (isDirectory(path)) {
        return failureVoid(IoError::IsDirectory);
    }

    std::ofstream output(path, std::ios::binary | std::ios::app);
    if (!output.is_open()) {
        return failureVoid(IoError::Other);
    }
    output << value;
    return successVoid();
}

inline doof::Result<void, IoError> copy(const std::string& fromPath, const std::string& toPath) {
    if (!exists(fromPath)) {
        return failureVoid(IoError::NotFound);
    }
    if (exists(toPath)) {
        return failureVoid(IoError::AlreadyExists);
    }

    std::error_code error;
    const bool copied = std::filesystem::copy_file(fromPath, toPath, std::filesystem::copy_options::none, error);
    if (!copied) {
        return failureVoid(error ? mapIoError(error) : IoError::Other);
    }
    return successVoid();
}

inline doof::Result<void, IoError> rename(const std::string& fromPath, const std::string& toPath) {
    std::error_code error;
    std::filesystem::rename(fromPath, toPath, error);
    if (error) {
        return failureVoid(mapIoError(error));
    }
    return successVoid();
}

inline doof::Result<void, IoError> remove(const std::string& path) {
    std::error_code error;
    const bool removed = std::filesystem::remove(path, error);
    if (error) {
        return failureVoid(mapIoError(error));
    }
    if (!removed) {
        return failureVoid(IoError::NotFound);
    }
    return successVoid();
}

inline doof::Result<void, IoError> writeBytes(
    const std::string& path,
    const std::shared_ptr<std::vector<int32_t>>& value
) {
    if (isDirectory(path)) {
        return failureVoid(IoError::IsDirectory);
    }

    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) {
        return failureVoid(IoError::Other);
    }
    const auto& bytes = value ? *value : std::vector<int32_t>{};
    for (int32_t item : bytes) {
        output.put(static_cast<char>(item & 0xff));
    }
    return successVoid();
}

inline doof::Result<std::shared_ptr<std::vector<int32_t>>, IoError> readBytes(const std::string& path) {
    if (!exists(path)) {
        return doof::Result<std::shared_ptr<std::vector<int32_t>>, IoError>::failure(IoError::NotFound);
    }
    if (isDirectory(path)) {
        return doof::Result<std::shared_ptr<std::vector<int32_t>>, IoError>::failure(IoError::IsDirectory);
    }

    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) {
        return doof::Result<std::shared_ptr<std::vector<int32_t>>, IoError>::failure(IoError::Other);
    }

    std::vector<int32_t> value;
    char byte = 0;
    while (input.get(byte)) {
      value.push_back(static_cast<unsigned char>(byte));
    }
    return doof::Result<std::shared_ptr<std::vector<int32_t>>, IoError>::success(
        std::make_shared<std::vector<int32_t>>(std::move(value))
    );
}

inline doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError> readDir(
    const std::string& path
) {
    if (!exists(path)) {
        return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(IoError::NotFound);
    }
    if (!isDirectory(path)) {
        return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(IoError::NotDirectory);
    }

    std::error_code error;
    std::vector<std::shared_ptr<DirEntry>> entries;
    for (const auto& entry : std::filesystem::directory_iterator(path, error)) {
        if (error) {
            return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(mapIoError(error));
        }

        const std::string name = entry.path().filename().string();
        EntryKind kind = EntryKind::Other;
        int64_t size = 0;

        const auto status = entry.symlink_status(error);
        if (error) {
            return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(mapIoError(error));
        }
        if (std::filesystem::is_symlink(status)) {
            kind = EntryKind::Symlink;
        } else if (std::filesystem::is_directory(status)) {
            kind = EntryKind::Directory;
        } else if (std::filesystem::is_regular_file(status)) {
            kind = EntryKind::File;
            size = static_cast<int64_t>(entry.file_size(error));
            if (error) {
                return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(mapIoError(error));
            }
        } else {
            kind = EntryKind::Other;
        }

        entries.push_back(std::make_shared<DirEntry>(name, kind, size));
    }
    if (error) {
        return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::failure(mapIoError(error));
    }

    return doof::Result<std::shared_ptr<std::vector<std::shared_ptr<DirEntry>>>, IoError>::success(
        std::make_shared<std::vector<std::shared_ptr<DirEntry>>>(std::move(entries))
    );
}

} // namespace doof_fs