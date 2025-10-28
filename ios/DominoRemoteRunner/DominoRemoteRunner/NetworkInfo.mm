#import "NetworkInfo.h"

#include <ifaddrs.h>
#include <arpa/inet.h>
#include <net/if.h>

@implementation NetworkEndpoint

- (instancetype)initWithInterface:(NSString *)interfaceName
                           address:(NSString *)address
                             family:(NetworkEndpointFamily)family {
    self = [super init];
    if (self) {
        _interfaceName = [interfaceName copy];
        _address = [address copy];
        _family = family;
    }
    return self;
}

- (NSString *)displayLabel {
    switch (self.family) {
        case NetworkEndpointFamilyIPv4:
            return [NSString stringWithFormat:@"%@ • IPv4", self.interfaceName];
        case NetworkEndpointFamilyIPv6:
            return [NSString stringWithFormat:@"%@ • IPv6", self.interfaceName];
    }
    return self.interfaceName;
}

@end

@implementation NetworkInfo

+ (NSArray<NetworkEndpoint *> *)activeEndpoints {
    NSMutableArray<NetworkEndpoint *> *endpoints = [NSMutableArray array];
    struct ifaddrs *interfaces = NULL;
    if (getifaddrs(&interfaces) != 0 || interfaces == NULL) {
        return endpoints;
    }

    struct ifaddrs *cursor = interfaces;
    while (cursor != NULL) {
        if (cursor->ifa_addr == NULL) {
            cursor = cursor->ifa_next;
            continue;
        }

        int flags = cursor->ifa_flags;
        BOOL running = (flags & (IFF_UP | IFF_RUNNING)) == (IFF_UP | IFF_RUNNING);
        BOOL loopback = (flags & IFF_LOOPBACK) != 0;
        if (!running || loopback) {
            cursor = cursor->ifa_next;
            continue;
        }

        sa_family_t addressFamily = cursor->ifa_addr->sa_family;
        char hostBuffer[INET6_ADDRSTRLEN] = {0};
        NSString *interfaceName = [NSString stringWithUTF8String:cursor->ifa_name];

        if (addressFamily == AF_INET) {
            struct sockaddr_in *addr = (struct sockaddr_in *)cursor->ifa_addr;
            const char *result = inet_ntop(AF_INET, &(addr->sin_addr), hostBuffer, sizeof(hostBuffer));
            if (result != NULL) {
                NSString *address = [NSString stringWithUTF8String:hostBuffer];
                NetworkEndpoint *endpoint = [[NetworkEndpoint alloc] initWithInterface:interfaceName
                                                                                address:address
                                                                                  family:NetworkEndpointFamilyIPv4];
                [endpoints addObject:endpoint];
            }
        } else if (addressFamily == AF_INET6) {
            struct sockaddr_in6 *addr = (struct sockaddr_in6 *)cursor->ifa_addr;
            const char *result = inet_ntop(AF_INET6, &(addr->sin6_addr), hostBuffer, sizeof(hostBuffer));
            if (result != NULL) {
                NSString *raw = [NSString stringWithUTF8String:hostBuffer];
                NSRange percentRange = [raw rangeOfString:@"%"];
                NSString *clean = percentRange.location != NSNotFound ? [raw substringToIndex:percentRange.location] : raw;
                NetworkEndpoint *endpoint = [[NetworkEndpoint alloc] initWithInterface:interfaceName
                                                                                address:clean
                                                                                  family:NetworkEndpointFamilyIPv6];
                [endpoints addObject:endpoint];
            }
        }

        cursor = cursor->ifa_next;
    }

    freeifaddrs(interfaces);

    [endpoints sortUsingComparator:^NSComparisonResult(NetworkEndpoint *lhs, NetworkEndpoint *rhs) {
        NSComparisonResult nameCompare = [lhs.interfaceName compare:rhs.interfaceName];
        if (nameCompare != NSOrderedSame) {
            return nameCompare;
        }
        return lhs.family < rhs.family ? NSOrderedAscending : (lhs.family > rhs.family ? NSOrderedDescending : NSOrderedSame);
    }];

    return endpoints;
}

@end
