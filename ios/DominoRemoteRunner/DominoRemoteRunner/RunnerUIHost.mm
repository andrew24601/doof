#import "RunnerUIHost.h"

#import "RunnerCanvasViewController.h"
#import "RemoteRunnerService.h"

@interface RunnerUIHost ()
@property (nonatomic, strong, nullable) RunnerCanvasViewController *canvasController;
@end

@implementation RunnerUIHost

+ (instancetype)sharedHost {
    static RunnerUIHost *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[RunnerUIHost alloc] init];
    });
    return sharedInstance;
}

- (void)presentRunner {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{ [self presentRunner]; });
        return;
    }
    if (!self.navigationController) {
        return;
    }
    if (!self.canvasController) {
        self.canvasController = [[RunnerCanvasViewController alloc] init];
        __weak typeof(self) weakSelf = self;
        self.canvasController.closeHandler = ^{
            [weakSelf closeRunnerAndRestart];
        };
    }
    if (self.canvasController.presentingViewController || self.navigationController.presentedViewController == self.canvasController) {
        return;
    }
    if (self.navigationController.presentedViewController == self.canvasController) {
        return;
    }
    [self.navigationController presentViewController:self.canvasController animated:YES completion:nil];
}

- (void)dismissRunnerWithCompletion:(void (^ _Nullable)(void))completion {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{ [self dismissRunnerWithCompletion:completion]; });
        return;
    }
    UIViewController *presented = self.navigationController.presentedViewController;
    if (presented == self.canvasController) {
        __weak typeof(self) weakSelf = self;
        RunnerCanvasViewController *controller = self.canvasController;
        [presented dismissViewControllerAnimated:YES completion:^{
            [controller removeAllLabels];
            weakSelf.canvasController = nil;
            if (completion) {
                completion();
            }
        }];
    } else if (completion) {
        completion();
    }
}

- (UILabel *)createLabel {
    __block UILabel *label = nil;
    if ([NSThread isMainThread]) {
        [self presentRunner];
        if (self.canvasController) {
            label = [self.canvasController addLabel];
        }
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{
            [self presentRunner];
            if (!self.canvasController) {
                return;
            }
            label = [self.canvasController addLabel];
        });
    }
    return label;
}

- (void)setLabel:(UILabel *)label text:(NSString *)text {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.canvasController setLabel:label text:text ?: @""];
    });
}

- (void)setLabel:(UILabel *)label hidden:(BOOL)hidden {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.canvasController setLabel:label hidden:hidden];
    });
}

- (void)removeLabel:(UILabel *)label {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.canvasController removeLabel:label];
    });
}

- (void)removeAllLabels {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.canvasController removeAllLabels];
    });
}

- (void)closeRunnerAndRestart {
    dispatch_async(dispatch_get_main_queue(), ^{
        RemoteRunnerService *service = self.runnerService;
        [self dismissRunnerWithCompletion:nil];
        if (!service) {
            return;
        }
        uint16_t port = service.requestedPort;
        [service stop];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [service setRequestedPort:port];
            [service start];
        });
    });
}

@end
