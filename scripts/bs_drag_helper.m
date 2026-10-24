// File drag for Better Sampler Reactive 2. Same JSON protocol as XO's helper, but a drag starts in
// mouseDragged with that event. The old tracking loop called beginDraggingSession with the original
// mouseDown after the mouse had already moved, and Ableton never accepted the drop.
//
//   clang -O2 -framework Cocoa -framework ApplicationServices scripts/bs_drag_helper.m -o /tmp/bs_drag_helper_v1_bin
//
// stdin: one JSON object per line. {"cmd":"arm","mode":"selected_raw","paths":["/file.wav"],"w":80,"h":15,"stateFile":"..."}
// {"cmd":"disarm"}. stdout: REPLAY_CLICK on a click that did not drag, END <operation> when a drag finishes.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

@interface BSDragView : NSView <NSDraggingSource>
@property (nonatomic, strong) NSArray<NSString *> *filePaths;
@property (nonatomic, copy) NSString *dragMode;
@property (nonatomic, strong) NSEvent *mouseDownEvent;
@property (nonatomic, assign) BOOL didDrag;
@end

@implementation BSDragView

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
    return NSDragOperationCopy | NSDragOperationLink | NSDragOperationGeneric;
}

- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)screenPoint operation:(NSDragOperation)operation {
    fprintf(stdout, "END %lu\n", (unsigned long)operation);
    fflush(stdout);
    [[self window] orderOut:nil];
}

- (void)mouseDown:(NSEvent *)event {
    self.mouseDownEvent = event;
    self.didDrag = NO;
    // Dedicated drag buttons start immediately. The sample name waits so a click can still open the file dialog.
    if (![self.dragMode isEqualToString:@"selected_raw"]) {
        self.didDrag = YES;
        [self initiateOSFileDrag:event];
    }
}

- (void)mouseDragged:(NSEvent *)event {
    if (self.didDrag) return;
    if (![self.dragMode isEqualToString:@"selected_raw"]) return;
    NSPoint a = [self.mouseDownEvent locationInWindow];
    NSPoint b = [event locationInWindow];
    CGFloat dx = b.x - a.x, dy = b.y - a.y;
    if (dx * dx + dy * dy < 9.0) return;
    self.didDrag = YES;
    [self initiateOSFileDrag:event];
}

- (void)mouseUp:(NSEvent *)event {
    if (self.didDrag) return;
    if (![self.dragMode isEqualToString:@"selected_raw"]) return;
    [[self window] orderOut:nil];
    fprintf(stdout, "REPLAY_CLICK\n");
    fflush(stdout);
}

- (void)initiateOSFileDrag:(NSEvent *)event {
    if (!self.filePaths || self.filePaths.count == 0) return;
    NSMutableArray<NSDraggingItem *> *items = [NSMutableArray array];
    NSMutableArray<NSURL *> *urls = [NSMutableArray array];

    for (NSString *p in self.filePaths) {
        if (![[NSFileManager defaultManager] fileExistsAtPath:p]) continue;
        NSURL *u = [NSURL fileURLWithPath:p];
        if (!u) continue;
        [urls addObject:u];

        NSDraggingItem *di = [[NSDraggingItem alloc] initWithPasteboardWriter:u];
        NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:p];
        [icon setSize:NSMakeSize(32, 32)];
        [di setDraggingFrame:NSMakeRect(0, 0, 32, 32) contents:icon];
        [items addObject:di];
    }
    if (items.count == 0) return;

    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    [pb clearContents];
    [pb writeObjects:urls];

    [self beginDraggingSessionWithItems:items event:event source:self];
}

- (void)drawRect:(NSRect)dirtyRect {
    // Alpha just above 0.05 so WindowServer delivers mouseDown, without a visible box.
    [[NSColor colorWithCalibratedRed:0.06 green:0.07 blue:0.09 alpha:0.051] setFill];
    NSRectFill(self.bounds);
}
@end

@interface BSDragApp : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) NSPanel *dragWindow;
@property (nonatomic, strong) BSDragView *dragView;
@end

@implementation BSDragApp

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSRect frame = NSMakeRect(0, 0, 44, 20);
    self.dragWindow = [[NSPanel alloc] initWithContentRect:frame
                                                 styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
    [self.dragWindow setOpaque:NO];
    [self.dragWindow setBackgroundColor:[NSColor clearColor]];
    [self.dragWindow setFloatingPanel:YES];
    [self.dragWindow setBecomesKeyOnlyIfNeeded:YES];
    [self.dragWindow setLevel:NSStatusWindowLevel];
    [self.dragWindow setHasShadow:NO];
    [self.dragWindow setIgnoresMouseEvents:NO];
    [self.dragWindow setAcceptsMouseMovedEvents:YES];

    self.dragView = [[BSDragView alloc] initWithFrame:frame];
    [self.dragWindow setContentView:self.dragView];

    [NSTimer scheduledTimerWithTimeInterval:0.025 repeats:YES block:^(NSTimer * _Nonnull timer) {
        if (![self.dragWindow isVisible]) return;
        if ([NSEvent pressedMouseButtons] != 0) return;
        NSPoint cur = [NSEvent mouseLocation];
        if (!NSPointInRect(cur, [self.dragWindow frame])) {
            [self.dragWindow orderOut:nil];
        }
    }];

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        char buf[65536];
        while (fgets(buf, sizeof(buf), stdin) != NULL) {
            NSString *line = [NSString stringWithUTF8String:buf];
            if (!line) continue;
            NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if (!json) continue;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self handleCommand:json];
            });
        }
        exit(0);
    });
    fprintf(stdout, "READY\n");
    fflush(stdout);
}

- (void)handleCommand:(NSDictionary *)cmd {
    NSString *action = cmd[@"cmd"];
    if ([action isEqualToString:@"disarm"]) {
        if (([NSEvent pressedMouseButtons] & 1) == 0) {
            [self.dragWindow orderOut:nil];
        }
        return;
    }
    NSArray *paths = cmd[@"paths"];
    if (!paths || paths.count == 0) return;

    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    for (NSString *p in paths) {
        if ([[NSFileManager defaultManager] fileExistsAtPath:p]) {
            [urls addObject:[NSURL fileURLWithPath:p]];
        }
    }
    if (urls.count > 0) {
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];
        [pb writeObjects:urls];
    }

    NSPoint mouse = [NSEvent mouseLocation];
    CGFloat w = [cmd[@"w"] doubleValue] ?: 24.0;
    CGFloat h = [cmd[@"h"] doubleValue] ?: 18.0;
    self.dragView.filePaths = paths;
    self.dragView.dragMode = cmd[@"mode"] ?: @"raw";

    NSRect winRect = NSMakeRect(mouse.x - w * 0.5, mouse.y - h * 0.5, w, h);
    [self.dragWindow setFrame:winRect display:YES];
    [self.dragView setFrame:NSMakeRect(0, 0, w, h)];
    [self.dragView setNeedsDisplay:YES];
    [self.dragWindow orderFrontRegardless];

    NSString *stateFile = cmd[@"stateFile"];
    if (stateFile) {
        NSDictionary *st = @{
            @"visible": @([self.dragWindow isVisible]),
            @"count": @(urls.count),
            @"paths": paths
        };
        NSData *stData = [NSJSONSerialization dataWithJSONObject:st options:0 error:nil];
        [stData writeToFile:stateFile atomically:YES];
    }
}
@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        BSDragApp *del = [[BSDragApp alloc] init];
        [app setDelegate:del];
        [app run];
    }
    return 0;
}
