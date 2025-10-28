#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class RemoteRunnerService;
@class RunnerCanvasViewController;

@interface RunnerUIHost : NSObject

@property (nonatomic, weak, nullable) UINavigationController *navigationController;
@property (nonatomic, strong, nullable) RemoteRunnerService *runnerService;

+ (instancetype)sharedHost;

- (void)presentRunner;
- (void)dismissRunnerWithCompletion:(void (^ _Nullable)(void))completion;
- (UILabel *)createLabel;
- (void)setLabel:(UILabel *)label text:(NSString *)text;
- (void)setLabel:(UILabel *)label hidden:(BOOL)hidden;
- (void)removeLabel:(UILabel *)label;
- (void)removeAllLabels;
- (void)closeRunnerAndRestart;

@end

NS_ASSUME_NONNULL_END
