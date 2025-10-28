#import "RemoteRunnerBridge.h"

#import "RunnerUIHost.h"

#include "../../../vm/include/DoofVM.h"
#include "../../../vm/include/vm_glue_helpers.h"

#include <mutex>

namespace DominoRemoteRunner {

class Label;

class Runner {
public:
    static std::shared_ptr<Runner> shared();

    void show();
    void close();
    std::shared_ptr<Label> createLabel();

private:
    Runner() = default;
};

class Label {
public:
    explicit Label(UILabel *label);
    ~Label();

    void setText(const std::string &text);
    void setVisible(bool visible);
    void destroy();

private:
    __weak UILabel *label_ = nil;
    bool destroyed_ = false;
};

} // namespace DominoRemoteRunner

namespace DominoRemoteRunner {

namespace {
std::mutex gRunnerMutex;
std::weak_ptr<Runner> gSharedRunner;
}

std::shared_ptr<Runner> Runner::shared() {
    std::lock_guard<std::mutex> lock(gRunnerMutex);
    auto existing = gSharedRunner.lock();
    if (!existing) {
        existing = std::shared_ptr<Runner>(new Runner());
        gSharedRunner = existing;
    }
    return existing;
}

void Runner::show() {
    [[RunnerUIHost sharedHost] removeAllLabels];
    [[RunnerUIHost sharedHost] presentRunner];
}

void Runner::close() {
    [[RunnerUIHost sharedHost] closeRunnerAndRestart];
}

std::shared_ptr<Label> Runner::createLabel() {
    UILabel *label = [[RunnerUIHost sharedHost] createLabel];
    if (!label) {
        return nullptr;
    }
    return std::make_shared<Label>(label);
}

Label::Label(UILabel *label)
: label_(label) {}

Label::~Label() {
    destroy();
}

void Label::setText(const std::string &text) {
    if (destroyed_) {
        return;
    }
    UILabel *label = label_;
    if (!label) {
        return;
    }
    NSString *string = [[NSString alloc] initWithBytes:text.data()
                                                length:text.size()
                                              encoding:NSUTF8StringEncoding];
    if (!string) {
        string = @"";
    }
    [[RunnerUIHost sharedHost] setLabel:label text:string];
}

void Label::setVisible(bool visible) {
    if (destroyed_) {
        return;
    }
    UILabel *label = label_;
    if (!label) {
        return;
    }
    [[RunnerUIHost sharedHost] setLabel:label hidden:!visible];
}

void Label::destroy() {
    if (destroyed_) {
        return;
    }
    UILabel *label = label_;
    if (label) {
        [[RunnerUIHost sharedHost] removeLabel:label];
    }
    label_ = nil;
    destroyed_ = true;
}

} // namespace DominoRemoteRunner

namespace {

using DominoRemoteRunner::Label;
using DominoRemoteRunner::Runner;

struct RemoteRunnerObject : public Object {
    std::shared_ptr<Runner> runner;
};

struct RemoteLabelObject : public Object {
    ~RemoteLabelObject() override {
        if (label) {
            label->destroy();
        }
    }

    std::shared_ptr<Label> label;
};

Value wrap_runner(const DoofVM::ExternClassHandle &handle,
                  const std::shared_ptr<Runner> &runner) {
    if (!runner) {
        return Value::make_null();
    }
    auto wrapper = std::make_shared<RemoteRunnerObject>();
    wrapper->runner = runner;
    return DoofVM::wrap_extern_object(handle, wrapper);
}

Value wrap_label(const DoofVM::ExternClassHandle &handle,
                 const std::shared_ptr<Label> &label) {
    if (!label) {
        return Value::make_null();
    }
    auto wrapper = std::make_shared<RemoteLabelObject>();
    wrapper->label = label;
    return DoofVM::wrap_extern_object(handle, wrapper);
}

void register_remote_runner_externs(DoofVM *vm) {
    auto runnerHandle = vm->ensure_extern_class("RemoteRunner");
    auto labelHandle = vm->ensure_extern_class("RemoteLabel");

    vm->register_extern_function("RemoteRunner::shared",
                                 [runnerHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteRunner::shared", args, [&]() -> Value {
            auto runner = Runner::shared();
            return wrap_runner(runnerHandle, runner);
        });
    });

    vm->register_extern_function("RemoteRunner::show",
                                 [runnerHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteRunner::show", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteRunnerObject>(args,
                                                                            0,
                                                                            runnerHandle,
                                                                            "RemoteRunner::show",
                                                                            "self");
            if (receiver && receiver->runner) {
                receiver->runner->show();
            }
            return Value::make_null();
        });
    });

    vm->register_extern_function("RemoteRunner::close",
                                 [runnerHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteRunner::close", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteRunnerObject>(args,
                                                                            0,
                                                                            runnerHandle,
                                                                            "RemoteRunner::close",
                                                                            "self");
            if (receiver && receiver->runner) {
                receiver->runner->close();
            }
            return Value::make_null();
        });
    });

    vm->register_extern_function("RemoteRunner::createLabel",
                                 [runnerHandle, labelHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteRunner::createLabel", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteRunnerObject>(args,
                                                                            0,
                                                                            runnerHandle,
                                                                            "RemoteRunner::createLabel",
                                                                            "self");
            if (!receiver || !receiver->runner) {
                return Value::make_null();
            }
            auto label = receiver->runner->createLabel();
            return wrap_label(labelHandle, label);
        });
    });

    vm->register_extern_function("RemoteLabel::setText",
                                 [labelHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteLabel::setText", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteLabelObject>(args,
                                                                           0,
                                                                           labelHandle,
                                                                           "RemoteLabel::setText",
                                                                           "self");
            auto text = DoofVMGlue::expect_string(args,
                                                    1,
                                                    "RemoteLabel::setText",
                                                    "text");
            if (receiver && receiver->label) {
                receiver->label->setText(text);
            }
            return Value::make_null();
        });
    });

    vm->register_extern_function("RemoteLabel::setVisible",
                                 [labelHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteLabel::setVisible", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteLabelObject>(args,
                                                                           0,
                                                                           labelHandle,
                                                                           "RemoteLabel::setVisible",
                                                                           "self");
            auto visible = DoofVMGlue::expect_bool(args,
                                                     1,
                                                     "RemoteLabel::setVisible",
                                                     "visible");
            if (receiver && receiver->label) {
                receiver->label->setVisible(visible);
            }
            return Value::make_null();
        });
    });

    vm->register_extern_function("RemoteLabel::destroy",
                                 [labelHandle](Value *args) -> Value {
        return DoofVMGlue::dispatch("RemoteLabel::destroy", args, [&]() -> Value {
            auto receiver = DoofVMGlue::expect_object<RemoteLabelObject>(args,
                                                                           0,
                                                                           labelHandle,
                                                                           "RemoteLabel::destroy",
                                                                           "self");
            if (receiver && receiver->label) {
                receiver->label->destroy();
                receiver->label.reset();
            }
            return Value::make_null();
        });
    });
}

void remote_runner_vm_initializer(DoofVM *vm, void * /*user_data*/) {
    register_remote_runner_externs(vm);
}

} // namespace

extern "C" void DominoRemoteRunnerInstallExterns(void) {
    doof_vm_set_vm_initializer(remote_runner_vm_initializer, nullptr);
}
