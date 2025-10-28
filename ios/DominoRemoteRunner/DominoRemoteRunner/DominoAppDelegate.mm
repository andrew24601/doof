#import "DominoAppDelegate.h"

#import "RunnerSettingsViewController.h"
#import "RemoteRunnerService.h"
#import "RunnerUIHost.h"
#import "RemoteRunnerBridge.h"

@interface DominoAppDelegate ()
@property (strong, nonatomic, readwrite) UINavigationController *navigationController;
@property (strong, nonatomic, readwrite) RemoteRunnerService *runnerService;
@end

@implementation DominoAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    DominoRemoteRunnerInstallExterns();

    self.runnerService = [[RemoteRunnerService alloc] init];

    RunnerSettingsViewController *settingsController = [[RunnerSettingsViewController alloc] initWithService:self.runnerService];
    self.navigationController = [[UINavigationController alloc] initWithRootViewController:settingsController];
    self.navigationController.navigationBar.prefersLargeTitles = YES;

    self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
    self.window.rootViewController = self.navigationController;
    [self.window makeKeyAndVisible];

    [[RunnerUIHost sharedHost] setNavigationController:self.navigationController];
    [[RunnerUIHost sharedHost] setRunnerService:self.runnerService];

    [self.runnerService activateIfNeeded];

    return YES;
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
    [self.runnerService activateIfNeeded];
}

- (void)applicationDidEnterBackground:(UIApplication *)application {
    [self.runnerService suspendIfNeeded];
}

@end
