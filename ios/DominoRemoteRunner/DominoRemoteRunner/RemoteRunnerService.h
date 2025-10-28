#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class RemoteRunnerService;

typedef NS_ENUM(NSInteger, RemoteRunnerState) {
    RemoteRunnerStateIdle = 0,
    RemoteRunnerStateStarting,
    RemoteRunnerStateRunning,
    RemoteRunnerStateError
};

@protocol RemoteRunnerServiceObserver <NSObject>
- (void)remoteRunnerServiceDidUpdate:(RemoteRunnerService *)service;
@end

@interface RemoteRunnerService : NSObject

@property (atomic, assign, readonly) RemoteRunnerState state;
@property (atomic, assign, readonly) uint16_t requestedPort;
@property (atomic, copy, readonly, nullable) NSString *lastError;
@property (atomic, assign, readonly) BOOL autoStartOnForeground;

- (instancetype)init NS_DESIGNATED_INITIALIZER;
- (void)addObserver:(id<RemoteRunnerServiceObserver>)observer;
- (void)removeObserver:(id<RemoteRunnerServiceObserver>)observer;

- (void)activateIfNeeded;
- (void)suspendIfNeeded;
- (void)start;
- (void)stop;
- (void)restartOnPort:(uint16_t)port;
- (void)setRequestedPort:(uint16_t)port;
- (void)setAutoStartOnForeground:(BOOL)enabled;

@end

NS_ASSUME_NONNULL_END
