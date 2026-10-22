// Test tool for the tart VM (AGENTS.md 1a): a real macOS file drag source, so a test can drop a file on a Max / Live
// device with real OS events (scripts/mm_os_input.py presses and moves the mouse). Reverb+ uses it to check the
// whole-face drop target (scripts/test_reverbplus_live.js).
//
//   clang -fobjc-arc -framework Cocoa scripts/rp_drag_source.m -o /tmp/rp_drag_source
//   /tmp/rp_drag_source <file> <x> <y> [w h]     x, y = top-left screen point (points); default size 40 x 20
//
// It shows a nearly invisible borderless panel there; a left mouse press on it starts a drag session carrying the file
// (NSPasteboard file URL, the same data Finder puts there). It prints READY once the panel is up, and "END <operation>"
// when the drag finishes (operation 0 = nobody accepted the drop), then exits (also after 40 s).
#import <Cocoa/Cocoa.h>

@interface DragView : NSView <NSDraggingSource>
@property (nonatomic, copy) NSString *path;
@end

@implementation DragView
- (BOOL)acceptsFirstMouse:(NSEvent *)e { return YES; }
- (NSDragOperation)draggingSession:(NSDraggingSession *)s sourceOperationMaskForDraggingContext:(NSDraggingContext)c {
    return NSDragOperationCopy | NSDragOperationLink | NSDragOperationGeneric;
}
- (void)draggingSession:(NSDraggingSession *)s endedAtPoint:(NSPoint)p operation:(NSDragOperation)op {
    printf("END %lu\n", (unsigned long)op);
    fflush(stdout);
    exit(0);
}
- (void)mouseDown:(NSEvent *)event {
    NSURL *u = [NSURL fileURLWithPath:self.path];
    NSDraggingItem *di = [[NSDraggingItem alloc] initWithPasteboardWriter:u];
    NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:self.path];
    [icon setSize:NSMakeSize(32, 32)];
    [di setDraggingFrame:NSMakeRect(0, 0, 32, 32) contents:icon];
    [self beginDraggingSessionWithItems:@[di] event:event source:self];
}
- (void)drawRect:(NSRect)r {
    [[NSColor colorWithCalibratedRed:0.5 green:0.5 blue:0.5 alpha:0.6] setFill];
    NSRectFill(self.bounds);
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 4) { fprintf(stderr, "usage: rp_drag_source <file> <x> <y> [w h]\n"); return 2; }
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        double x = atof(argv[2]), y = atof(argv[3]);
        double w = argc > 5 ? atof(argv[4]) : 40, h = argc > 5 ? atof(argv[5]) : 20;
        double sh = [[NSScreen screens][0] frame].size.height;
        NSPanel *win = [[NSPanel alloc] initWithContentRect:NSMakeRect(x, sh - y - h, w, h)
                                                  styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
                                                    backing:NSBackingStoreBuffered defer:NO];
        [win setLevel:NSStatusWindowLevel];
        DragView *v = [[DragView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
        v.path = [NSString stringWithUTF8String:argv[1]];
        [win setContentView:v];
        [win orderFrontRegardless];
        printf("READY\n");
        fflush(stdout);
        [NSTimer scheduledTimerWithTimeInterval:40 repeats:NO block:^(NSTimer *t) { exit(3); }];
        [app run];
    }
    return 0;
}
