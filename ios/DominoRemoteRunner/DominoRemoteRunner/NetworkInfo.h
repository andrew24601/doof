#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, NetworkEndpointFamily) {
    NetworkEndpointFamilyIPv4 = 0,
    NetworkEndpointFamilyIPv6
};

@interface NetworkEndpoint : NSObject
@property (nonatomic, copy, readonly) NSString *interfaceName;
@property (nonatomic, copy, readonly) NSString *address;
@property (nonatomic, assign, readonly) NetworkEndpointFamily family;
- (instancetype)initWithInterface:(NSString *)interfaceName
                           address:(NSString *)address
                             family:(NetworkEndpointFamily)family NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (NSString *)displayLabel;
@end

@interface NetworkInfo : NSObject
+ (NSArray<NetworkEndpoint *> *)activeEndpoints;
@end

NS_ASSUME_NONNULL_END
