#import <UIKit/UIKit.h>

@class RunnerSettingsViewController;
@class RemoteRunnerService;

@interface DominoAppDelegate : UIResponder <UIApplicationDelegate>

@property (strong, nonatomic) UIWindow *window;
@property (strong, nonatomic, readonly) UINavigationController *navigationController;
@property (strong, nonatomic, readonly) RemoteRunnerService *runnerService;

@end
