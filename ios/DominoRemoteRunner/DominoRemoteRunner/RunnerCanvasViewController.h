#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface RunnerCanvasViewController : UIViewController

@property (nonatomic, copy, nullable) void (^closeHandler)(void);

- (UILabel *)addLabel;
- (void)setLabel:(UILabel *)label text:(NSString *)text;
- (void)setLabel:(UILabel *)label hidden:(BOOL)hidden;
- (void)removeLabel:(UILabel *)label;
- (void)removeAllLabels;

@end

NS_ASSUME_NONNULL_END
