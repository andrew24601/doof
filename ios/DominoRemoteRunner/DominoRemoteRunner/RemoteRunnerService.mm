#import "RemoteRunnerService.h"

#import <UIKit/UIKit.h>
#import "../../../vm/include/DoofVM.h"

NS_ASSUME_NONNULL_BEGIN

static const uint16_t kDefaultPort = 7777;

@interface IdleTimerManager : NSObject
@property (nonatomic, assign) NSInteger disableCount;
+ (instancetype)sharedManager;
- (void)increment;
- (void)decrement;
@end

@implementation IdleTimerManager

+ (instancetype)sharedManager {
    static IdleTimerManager *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[IdleTimerManager alloc] init];
    });
    return sharedInstance;
}

- (void)increment {
    self.disableCount += 1;
    [self updateIdleTimer];
}

- (void)decrement {
    if (self.disableCount > 0) {
        self.disableCount -= 1;
    }
    [self updateIdleTimer];
}

- (void)updateIdleTimer {
    dispatch_async(dispatch_get_main_queue(), ^{
        [UIApplication sharedApplication].idleTimerDisabled = self.disableCount > 0;
    });
}

@end

@interface RemoteRunnerService ()
@property (atomic, assign, readwrite) RemoteRunnerState state;
@property (atomic, assign, readwrite) uint16_t requestedPort;
@property (atomic, copy, readwrite, nullable) NSString *lastError;
@property (atomic, assign, readwrite) BOOL autoStartOnForeground;
@property (atomic, assign) BOOL isRunning;
@property (atomic, strong) NSUUID *startToken;
@property (atomic, assign) BOOL resumeOnNextActivation;
@property (nonatomic, strong) NSHashTable<id<RemoteRunnerServiceObserver>> *observers;
@end

@implementation RemoteRunnerService

- (instancetype)init {
    self = [super init];
    if (self) {
        _state = RemoteRunnerStateIdle;
        _requestedPort = kDefaultPort;
        _autoStartOnForeground = YES;
        _resumeOnNextActivation = YES;
        _startToken = [NSUUID UUID];
        _observers = [NSHashTable weakObjectsHashTable];
    }
    return self;
}

- (void)addObserver:(id<RemoteRunnerServiceObserver>)observer {
    if (!observer) { return; }
    @synchronized (self.observers) {
        [self.observers addObject:observer];
    }
}

- (void)removeObserver:(id<RemoteRunnerServiceObserver>)observer {
    if (!observer) { return; }
    @synchronized (self.observers) {
        [self.observers removeObject:observer];
    }
}

- (void)activateIfNeeded {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.autoStartOnForeground) {
            return;
        }
        if (!self.resumeOnNextActivation) {
            return;
        }
        [self start];
    });
}

- (void)suspendIfNeeded {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.resumeOnNextActivation = self.autoStartOnForeground;
        [self stopWithUserInitiated:NO completion:nil];
    });
}

- (void)start {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.state == RemoteRunnerStateRunning || self.state == RemoteRunnerStateStarting) {
            return;
        }
        self.resumeOnNextActivation = YES;
        self.state = RemoteRunnerStateStarting;
        self.lastError = nil;
        NSUUID *token = [NSUUID UUID];
        self.startToken = token;
        uint16_t port = self.requestedPort;
        [self notifyObservers];

        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            char *errorPtr = NULL;
            int result = doof_vm_start_remote_server((int)port, &errorPtr, nullptr, nullptr);
            NSString *message = nil;
            if (errorPtr) {
                message = [NSString stringWithUTF8String:errorPtr];
                doof_vm_free_string(errorPtr);
            }

            dispatch_async(dispatch_get_main_queue(), ^{
                if (![self.startToken isEqual:token]) {
                    if (result == 0) {
                        doof_vm_stop_remote_server();
                    }
                    return;
                }

                if (result == 0) {
                    self.isRunning = YES;
                    self.state = RemoteRunnerStateRunning;
                    [[IdleTimerManager sharedManager] increment];
                } else {
                    self.isRunning = NO;
                    self.state = RemoteRunnerStateError;
                    self.lastError = message.length > 0 ? message : @"Unknown error";
                }
                [self notifyObservers];
            });
        });
    });
}

- (void)stop {
    [self stopWithUserInitiated:YES completion:nil];
}

- (void)stopWithUserInitiated:(BOOL)userInitiated completion:(void (^ _Nullable)(void))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        BOOL wasRunning = self.isRunning;
        if (!wasRunning && self.state != RemoteRunnerStateStarting) {
            if (userInitiated) {
                self.resumeOnNextActivation = NO;
            }
            if (completion) { completion(); }
            return;
        }

        self.startToken = [NSUUID UUID];
        self.isRunning = NO;
        self.state = RemoteRunnerStateIdle;
        self.lastError = nil;
        if (userInitiated) {
            self.resumeOnNextActivation = NO;
        }
        [self notifyObservers];

        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            doof_vm_stop_remote_server();
            if (wasRunning) {
                [[IdleTimerManager sharedManager] decrement];
            }
            if (completion) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    completion();
                });
            }
        });
    });
}

- (void)restartOnPort:(uint16_t)port {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self setRequestedPort:port];
        __weak typeof(self) weakSelf = self;
        [self stopWithUserInitiated:NO completion:^{
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (!strongSelf) { return; }
            strongSelf.resumeOnNextActivation = YES;
            [strongSelf start];
        }];
    });
}

- (void)setRequestedPort:(uint16_t)port {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self setRequestedPort:port];
        });
        return;
    }
    if (_requestedPort == port) {
        return;
    }
    _requestedPort = port;
    [self notifyObservers];
}

- (void)setAutoStartOnForeground:(BOOL)enabled {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self setAutoStartOnForeground:enabled];
        });
        return;
    }
    if (_autoStartOnForeground == enabled) {
        return;
    }
    _autoStartOnForeground = enabled;
    if (enabled) {
        self.resumeOnNextActivation = YES;
        [self start];
    } else {
        [self stopWithUserInitiated:NO completion:nil];
    }
    [self notifyObservers];
}

- (void)notifyObservers {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self notifyObservers];
        });
        return;
    }

    NSArray<id<RemoteRunnerServiceObserver>> *snapshot;
    @synchronized (self.observers) {
        snapshot = self.observers.allObjects;
    }
    for (id<RemoteRunnerServiceObserver> observer in snapshot) {
        [observer remoteRunnerServiceDidUpdate:self];
    }
}

@end

NS_ASSUME_NONNULL_END
