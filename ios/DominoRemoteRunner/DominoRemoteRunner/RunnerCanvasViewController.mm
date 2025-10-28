#import "RunnerCanvasViewController.h"

@interface RunnerCanvasViewController ()
@property (nonatomic, strong) UIStackView *labelsStack;
@property (nonatomic, strong) UIButton *closeButton;
@property (nonatomic, strong) NSMutableSet<UILabel *> *labels;
- (void)ensureViewHierarchyLoaded;
@end

@implementation RunnerCanvasViewController

- (instancetype)init {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _labels = [NSMutableSet set];
        self.modalPresentationStyle = UIModalPresentationFullScreen;
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor systemBackgroundColor];
    [self configureLayout];
}

- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated];
    [self.labels removeAllObjects];
}

- (void)configureLayout {
    self.closeButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [self.closeButton setTitle:@"Close" forState:UIControlStateNormal];
    self.closeButton.titleLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
    self.closeButton.translatesAutoresizingMaskIntoConstraints = NO;
    [self.closeButton addTarget:self action:@selector(closeButtonTapped:) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:self.closeButton];

    self.labelsStack = [[UIStackView alloc] init];
    self.labelsStack.axis = UILayoutConstraintAxisVertical;
    self.labelsStack.spacing = 16.0;
    self.labelsStack.translatesAutoresizingMaskIntoConstraints = NO;
    self.labelsStack.alignment = UIStackViewAlignmentCenter;
    [self.view addSubview:self.labelsStack];

    UILabel *placeholder = [[UILabel alloc] init];
    placeholder.text = @"Runner ready";
    placeholder.textColor = [UIColor secondaryLabelColor];
    placeholder.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle2];
    placeholder.tag = 999;
    [self.labelsStack addArrangedSubview:placeholder];

    [NSLayoutConstraint activateConstraints:@[
        [self.closeButton.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor constant:16.0],
        [self.closeButton.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-20.0],

        [self.labelsStack.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
        [self.labelsStack.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],
        [self.labelsStack.leadingAnchor constraintGreaterThanOrEqualToAnchor:self.view.leadingAnchor constant:20.0],
        [self.labelsStack.trailingAnchor constraintLessThanOrEqualToAnchor:self.view.trailingAnchor constant:-20.0]
    ]];
}

- (UILabel *)addLabel {
    [self ensureViewHierarchyLoaded];
    [self removePlaceholderIfNeeded];
    UILabel *label = [[UILabel alloc] init];
    label.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle1];
    label.textColor = [UIColor labelColor];
    label.numberOfLines = 0;
    label.textAlignment = NSTextAlignmentCenter;
    [self.labels addObject:label];
    [self.labelsStack addArrangedSubview:label];
    return label;
}

- (void)setLabel:(UILabel *)label text:(NSString *)text {
    if (![self.labels containsObject:label]) {
        return;
    }
    label.text = text.length > 0 ? text : @" ";
}

- (void)setLabel:(UILabel *)label hidden:(BOOL)hidden {
    if (![self.labels containsObject:label]) {
        return;
    }
    label.hidden = hidden;
}

- (void)removeLabel:(UILabel *)label {
    if (![self.labels containsObject:label]) {
        return;
    }
    [self.labels removeObject:label];
    [self.labelsStack removeArrangedSubview:label];
    [label removeFromSuperview];
    [self ensurePlaceholder];
}

- (void)removeAllLabels {
    [self ensureViewHierarchyLoaded];
    for (UILabel *label in self.labels) {
        [self.labelsStack removeArrangedSubview:label];
        [label removeFromSuperview];
    }
    [self.labels removeAllObjects];
    [self ensurePlaceholder];
}

- (void)closeButtonTapped:(id)sender {
    if (self.closeHandler) {
        self.closeHandler();
    }
}

#pragma mark - Helpers

- (void)ensureViewHierarchyLoaded {
    if (@available(iOS 9.0, *)) {
        [self loadViewIfNeeded];
    } else {
        (void)self.view;
    }
}

- (void)removePlaceholderIfNeeded {
    [self ensureViewHierarchyLoaded];
    for (UIView *view in self.labelsStack.arrangedSubviews) {
        if (view.tag == 999) {
            [self.labelsStack removeArrangedSubview:view];
            [view removeFromSuperview];
            break;
        }
    }
}

- (void)ensurePlaceholder {
    [self ensureViewHierarchyLoaded];
    if (self.labels.count > 0) {
        return;
    }
    BOOL hasPlaceholder = NO;
    for (UIView *view in self.labelsStack.arrangedSubviews) {
        if (view.tag == 999) {
            hasPlaceholder = YES;
            break;
        }
    }
    if (!hasPlaceholder) {
        UILabel *placeholder = [[UILabel alloc] init];
        placeholder.text = @"Runner ready";
        placeholder.textColor = [UIColor secondaryLabelColor];
        placeholder.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle2];
        placeholder.tag = 999;
        [self.labelsStack addArrangedSubview:placeholder];
    }
}

@end
