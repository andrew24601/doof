#import "RunnerSettingsViewController.h"

#import "NetworkInfo.h"

@interface RunnerSettingsViewController ()
@property (nonatomic, strong) RemoteRunnerService *service;
@property (nonatomic, strong) UIScrollView *scrollView;
@property (nonatomic, strong) UIStackView *stackView;
@property (nonatomic, strong) UILabel *statusLabel;
@property (nonatomic, strong) UILabel *errorLabel;
@property (nonatomic, strong) UITextField *portTextField;
@property (nonatomic, strong) UILabel *portErrorLabel;
@property (nonatomic, strong) UISwitch *autoStartSwitch;
@property (nonatomic, strong) UIButton *applyButton;
@property (nonatomic, strong) UIButton *primaryActionButton;
@property (nonatomic, strong) UIButton *restartButton;
@property (nonatomic, strong) UIStackView *endpointsStack;
@property (nonatomic, strong) NSMutableArray<NetworkEndpoint *> *endpoints;
@end

@implementation RunnerSettingsViewController

- (instancetype)initWithService:(RemoteRunnerService *)service {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _service = service;
        _endpoints = [NSMutableArray array];
        self.title = @"Domino Remote Runner";
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor systemBackgroundColor];
    [self configureNavigationItems];
    [self configureLayout];
    [self refreshEndpoints];
    [self updateUI];
}

- (void)viewWillAppear:(BOOL)animated {
    [super viewWillAppear:animated];
    [self.service addObserver:self];
    [self updateUI];
}

- (void)viewDidDisappear:(BOOL)animated {
    [super viewDidDisappear:animated];
    [self.service removeObserver:self];
}

#pragma mark - Layout

- (void)configureNavigationItems {
    UIBarButtonItem *refreshButton = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemRefresh
                                                                                   target:self
                                                                                   action:@selector(refreshButtonTapped:)];
    self.navigationItem.rightBarButtonItem = refreshButton;
}

- (void)configureLayout {
    self.scrollView = [[UIScrollView alloc] init];
    self.scrollView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.scrollView];

    UIView *contentView = [[UIView alloc] init];
    contentView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.scrollView addSubview:contentView];

    self.stackView = [[UIStackView alloc] init];
    self.stackView.axis = UILayoutConstraintAxisVertical;
    self.stackView.spacing = 20.0;
    self.stackView.translatesAutoresizingMaskIntoConstraints = NO;
    [contentView addSubview:self.stackView];

    [NSLayoutConstraint activateConstraints:@[
        [self.scrollView.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],
        [self.scrollView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.scrollView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.scrollView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],

        [contentView.topAnchor constraintEqualToAnchor:self.scrollView.topAnchor],
        [contentView.leadingAnchor constraintEqualToAnchor:self.scrollView.leadingAnchor],
        [contentView.trailingAnchor constraintEqualToAnchor:self.scrollView.trailingAnchor],
        [contentView.bottomAnchor constraintEqualToAnchor:self.scrollView.bottomAnchor],
        [contentView.widthAnchor constraintEqualToAnchor:self.scrollView.widthAnchor],

        [self.stackView.topAnchor constraintEqualToAnchor:contentView.topAnchor constant:24.0],
        [self.stackView.leadingAnchor constraintEqualToAnchor:contentView.leadingAnchor constant:20.0],
        [self.stackView.trailingAnchor constraintEqualToAnchor:contentView.trailingAnchor constant:-20.0],
        [self.stackView.bottomAnchor constraintEqualToAnchor:contentView.bottomAnchor constant:-24.0]
    ]];

    [self.stackView addArrangedSubview:[self createStatusSection]];
    [self.stackView addArrangedSubview:[self createPortSection]];
    [self.stackView addArrangedSubview:[self createAutoStartSection]];
    [self.stackView addArrangedSubview:[self createControlSection]];
    [self.stackView addArrangedSubview:[self createEndpointsSection]];
    [self.stackView addArrangedSubview:[self createInstructionsSection]];
}

- (UIView *)createSectionContainerWithTitle:(NSString *)title {
    UIStackView *sectionStack = [[UIStackView alloc] init];
    sectionStack.axis = UILayoutConstraintAxisVertical;
    sectionStack.spacing = 8.0;

    UILabel *headerLabel = [[UILabel alloc] init];
    headerLabel.text = title;
    headerLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
    [sectionStack addArrangedSubview:headerLabel];

    return sectionStack;
}

- (UIView *)createStatusSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"Status"];

    self.statusLabel = [[UILabel alloc] init];
    self.statusLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleSubheadline];

    self.errorLabel = [[UILabel alloc] init];
    self.errorLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    self.errorLabel.textColor = [UIColor secondaryLabelColor];
    self.errorLabel.numberOfLines = 0;

    [section addArrangedSubview:self.statusLabel];
    [section addArrangedSubview:self.errorLabel];

    return section;
}

- (UIView *)createPortSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"Connection"];

    UIStackView *row = [[UIStackView alloc] init];
    row.axis = UILayoutConstraintAxisHorizontal;
    row.spacing = 12.0;
    row.alignment = UIStackViewAlignmentLeading;

    self.portTextField = [[UITextField alloc] init];
    self.portTextField.keyboardType = UIKeyboardTypeNumberPad;
    self.portTextField.borderStyle = UITextBorderStyleRoundedRect;
    self.portTextField.placeholder = @"Port";
    self.portTextField.delegate = self;
    [self.portTextField addTarget:self action:@selector(portEditingDidEnd:) forControlEvents:UIControlEventEditingDidEndOnExit];

    self.applyButton = [self createButtonWithTitle:@"Apply" action:@selector(applyButtonTapped:)];

    [row addArrangedSubview:self.portTextField];
    [row addArrangedSubview:self.applyButton];

    self.portTextField.translatesAutoresizingMaskIntoConstraints = NO;
    [self.portTextField.widthAnchor constraintGreaterThanOrEqualToConstant:100.0].active = YES;
    self.applyButton.translatesAutoresizingMaskIntoConstraints = NO;

    self.portErrorLabel = [[UILabel alloc] init];
    self.portErrorLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    self.portErrorLabel.textColor = [UIColor systemRedColor];
    self.portErrorLabel.numberOfLines = 0;
    self.portErrorLabel.hidden = YES;

    [section addArrangedSubview:row];
    [section addArrangedSubview:self.portErrorLabel];

    return section;
}

- (UIView *)createAutoStartSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"Automation"];

    UIStackView *row = [[UIStackView alloc] init];
    row.axis = UILayoutConstraintAxisHorizontal;
    row.spacing = 12.0;
    row.alignment = UIStackViewAlignmentCenter;

    UILabel *label = [[UILabel alloc] init];
    label.text = @"Auto-start when app is active";
    label.font = [UIFont preferredFontForTextStyle:UIFontTextStyleSubheadline];

    self.autoStartSwitch = [[UISwitch alloc] init];
    [self.autoStartSwitch addTarget:self action:@selector(autoStartSwitchChanged:) forControlEvents:UIControlEventValueChanged];

    [row addArrangedSubview:label];
    [row addArrangedSubview:self.autoStartSwitch];

    [section addArrangedSubview:row];

    return section;
}

- (UIView *)createControlSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"Controls"];
    section.spacing = 12.0;

    self.primaryActionButton = [self createButtonWithTitle:@"Start server" action:@selector(primaryActionTapped:)];
    self.primaryActionButton.backgroundColor = [UIColor systemBlueColor];
    [self.primaryActionButton setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
    self.primaryActionButton.layer.cornerRadius = 8.0;
    self.primaryActionButton.contentEdgeInsets = UIEdgeInsetsMake(12, 20, 12, 20);

    self.restartButton = [self createButtonWithTitle:@"Restart" action:@selector(restartButtonTapped:)];
    self.restartButton.backgroundColor = [UIColor secondarySystemBackgroundColor];
    [self.restartButton setTitleColor:[UIColor labelColor] forState:UIControlStateNormal];
    self.restartButton.layer.cornerRadius = 8.0;
    self.restartButton.contentEdgeInsets = UIEdgeInsetsMake(12, 20, 12, 20);

    [section addArrangedSubview:self.primaryActionButton];
    [section addArrangedSubview:self.restartButton];

    return section;
}

- (UIView *)createEndpointsSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"Available addresses"];

    self.endpointsStack = [[UIStackView alloc] init];
    self.endpointsStack.axis = UILayoutConstraintAxisVertical;
    self.endpointsStack.spacing = 8.0;
    [section addArrangedSubview:self.endpointsStack];

    return section;
}

- (UIView *)createInstructionsSection {
    UIStackView *section = (UIStackView *)[self createSectionContainerWithTitle:@"VS Code Integration"];

    UILabel *instructions = [[UILabel alloc] init];
    instructions.numberOfLines = 0;
    instructions.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    instructions.text = @"1. Build the Domino VM XCFramework (\"vm/scripts/build_xcframework.sh\").\n2. Run this app on a device and keep it in the foreground.\n3. In VS Code, use a Domino Remote debug configuration with one of the addresses above.\n4. Ensure the port matches the value configured here before launching debugging.";

    [section addArrangedSubview:instructions];

    return section;
}

- (UIButton *)createButtonWithTitle:(NSString *)title action:(SEL)selector {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    [button setTitle:title forState:UIControlStateNormal];
    [button addTarget:self action:selector forControlEvents:UIControlEventTouchUpInside];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    return button;
}

#pragma mark - Actions

- (void)refreshButtonTapped:(id)sender {
    [self refreshEndpoints];
}

- (void)applyButtonTapped:(id)sender {
    [self applyPortChangeForceRestart:NO];
}

- (void)restartButtonTapped:(id)sender {
    [self applyPortChangeForceRestart:YES];
}

- (void)primaryActionTapped:(id)sender {
    RemoteRunnerState state = self.service.state;
    if (state == RemoteRunnerStateRunning || state == RemoteRunnerStateStarting) {
        [self.service stop];
    } else {
        [self applyPortChangeForceRestart:NO];
        [self.service start];
    }
}

- (void)autoStartSwitchChanged:(UISwitch *)sender {
    [self.service setAutoStartOnForeground:sender.isOn];
}

- (void)portEditingDidEnd:(UITextField *)textField {
    [self applyPortChangeForceRestart:NO];
}

#pragma mark - RemoteRunnerServiceObserver

- (void)remoteRunnerServiceDidUpdate:(RemoteRunnerService *)service {
    [self updateUI];
}

#pragma mark - Helpers

- (void)updateUI {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{ [self updateUI]; });
        return;
    }

    RemoteRunnerState state = self.service.state;
    switch (state) {
        case RemoteRunnerStateIdle:
            self.statusLabel.text = @"Idle";
            self.statusLabel.textColor = [UIColor secondaryLabelColor];
            break;
        case RemoteRunnerStateStarting:
            self.statusLabel.text = @"Starting server…";
            self.statusLabel.textColor = [UIColor labelColor];
            break;
        case RemoteRunnerStateRunning:
            self.statusLabel.text = [NSString stringWithFormat:@"Listening on port %u", self.service.requestedPort];
            self.statusLabel.textColor = [UIColor systemGreenColor];
            break;
        case RemoteRunnerStateError:
            self.statusLabel.text = @"Failed to start";
            self.statusLabel.textColor = [UIColor systemRedColor];
            break;
    }

    if (self.service.lastError.length > 0 && state == RemoteRunnerStateError) {
        self.errorLabel.text = self.service.lastError;
        self.errorLabel.hidden = NO;
    } else {
        self.errorLabel.text = @"";
        self.errorLabel.hidden = YES;
    }

    self.autoStartSwitch.on = self.service.autoStartOnForeground;
    self.portTextField.text = [NSString stringWithFormat:@"%u", self.service.requestedPort];
    [self rebuildEndpointViews];

    BOOL isStarting = state == RemoteRunnerStateStarting;
    BOOL isRunning = state == RemoteRunnerStateRunning;

    NSString *primaryTitle = isRunning ? @"Stop server" : (isStarting ? @"Cancel start" : @"Start server");
    [self.primaryActionButton setTitle:primaryTitle forState:UIControlStateNormal];
    self.primaryActionButton.backgroundColor = isRunning ? [UIColor systemRedColor] : (isStarting ? [UIColor systemOrangeColor] : [UIColor systemBlueColor]);
    [self.primaryActionButton setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];

    self.restartButton.hidden = !(isRunning || isStarting);
    self.restartButton.enabled = isRunning;
    self.applyButton.enabled = !isStarting;
    self.portTextField.enabled = !isStarting;
}

- (void)applyPortChangeForceRestart:(BOOL)forceRestart {
    NSString *text = self.portTextField.text ?: @"";
    NSCharacterSet *whitespace = [NSCharacterSet whitespaceAndNewlineCharacterSet];
    text = [text stringByTrimmingCharactersInSet:whitespace];

    NSInteger value = [text integerValue];
    if (value < 1024 || value > 65535) {
        self.portErrorLabel.text = @"Enter a port between 1024 and 65535.";
        self.portErrorLabel.hidden = NO;
        return;
    }

    self.portErrorLabel.hidden = YES;
    uint16_t portValue = (uint16_t)value;

    RemoteRunnerState state = self.service.state;
    if (state == RemoteRunnerStateRunning) {
        if (forceRestart || self.service.requestedPort != portValue) {
            [self.service restartOnPort:portValue];
        }
    } else if (state == RemoteRunnerStateStarting) {
        // Delay port update until stop completes
        __weak typeof(self) weakSelf = self;
        [self.service stop];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [weakSelf.service setRequestedPort:portValue];
        });
    } else {
        [self.service setRequestedPort:portValue];
    }

    [self.portTextField resignFirstResponder];
}

- (void)refreshEndpoints {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSArray<NetworkEndpoint *> *endpoints = [NetworkInfo activeEndpoints];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.endpoints removeAllObjects];
            [self.endpoints addObjectsFromArray:endpoints];
            [self rebuildEndpointViews];
        });
    });
}

- (void)rebuildEndpointViews {
    for (UIView *view in self.endpointsStack.arrangedSubviews) {
        [self.endpointsStack removeArrangedSubview:view];
        [view removeFromSuperview];
    }

    if (self.endpoints.count == 0) {
        UILabel *placeholder = [[UILabel alloc] init];
        placeholder.numberOfLines = 0;
        placeholder.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
        placeholder.textColor = [UIColor secondaryLabelColor];
        placeholder.text = @"Join the same network as your development machine and tap Refresh.";
        [self.endpointsStack addArrangedSubview:placeholder];
        return;
    }

    for (NetworkEndpoint *endpoint in self.endpoints) {
        UIStackView *row = [[UIStackView alloc] init];
        row.axis = UILayoutConstraintAxisHorizontal;
        row.alignment = UIStackViewAlignmentCenter;
        row.spacing = 12.0;

        UIStackView *labelColumn = [[UIStackView alloc] init];
        labelColumn.axis = UILayoutConstraintAxisVertical;
        labelColumn.spacing = 2.0;

        UILabel *interfaceLabel = [[UILabel alloc] init];
        interfaceLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleSubheadline];
        interfaceLabel.text = [endpoint displayLabel];

        UILabel *addressLabel = [[UILabel alloc] init];
        addressLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
        addressLabel.textColor = [UIColor secondaryLabelColor];
        NSString *address = [NSString stringWithFormat:@"%@: %u", endpoint.address, self.service.requestedPort];
        addressLabel.text = address;

        [labelColumn addArrangedSubview:interfaceLabel];
        [labelColumn addArrangedSubview:addressLabel];

        UIButton *copyButton = [UIButton buttonWithType:UIButtonTypeSystem];
        [copyButton setImage:[UIImage systemImageNamed:@"doc.on.doc"] forState:UIControlStateNormal];
        copyButton.accessibilityLabel = [NSString stringWithFormat:@"Copy %@", address];
        [copyButton addTarget:self action:@selector(copyEndpointButtonTapped:) forControlEvents:UIControlEventTouchUpInside];
        copyButton.tag = [self.endpoints indexOfObject:endpoint];

        [row addArrangedSubview:labelColumn];
        [row addArrangedSubview:copyButton];
        [self.endpointsStack addArrangedSubview:row];
    }
}

- (void)copyEndpointButtonTapped:(UIButton *)sender {
    NSInteger index = sender.tag;
    if (index < 0 || index >= self.endpoints.count) {
        return;
    }
    NetworkEndpoint *endpoint = self.endpoints[index];
    NSString *address = [NSString stringWithFormat:@"%@: %u", endpoint.address, self.service.requestedPort];
    [UIPasteboard generalPasteboard].string = address;

    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Address copied"
                                                                   message:address
                                                            preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

#pragma mark - UITextFieldDelegate

- (BOOL)textFieldShouldReturn:(UITextField *)textField {
    [self applyPortChangeForceRestart:NO];
    return YES;
}

@end
