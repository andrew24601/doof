#import <UIKit/UIKit.h>
#import "RemoteRunnerService.h"

NS_ASSUME_NONNULL_BEGIN

@interface RunnerSettingsViewController : UIViewController <RemoteRunnerServiceObserver, UITextFieldDelegate>

- (instancetype)initWithService:(RemoteRunnerService *)service NS_DESIGNATED_INITIALIZER;
- (instancetype)initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;
- (instancetype)initWithNibName:(NSString *)nibNameOrNil bundle:(NSBundle *)nibBundleOrNil NS_UNAVAILABLE;

@end

NS_ASSUME_NONNULL_END
