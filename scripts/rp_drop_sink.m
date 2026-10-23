// Test tool for the tart VM: a plain Cocoa window that accepts file drops and prints "DROP <path>" per file
// (to calibrate a Finder drag automation, scripts/drop_stress.py). clang -fobjc-arc -framework Cocoa scripts/rp_drop_sink.m -o /tmp/rp_drop_sink
//   /tmp/rp_drop_sink <x> <y> <w> <h>    top-left screen point; runs until killed
#import <Cocoa/Cocoa.h>
@interface SinkView : NSView @end
@implementation SinkView
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)s { return NSDragOperationCopy; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)s {
    NSArray *urls = [[s draggingPasteboard] readObjectsForClasses:@[[NSURL class]] options:nil];
    for (NSURL *u in urls) printf("DROP %s\n", [[u path] UTF8String]);
    fflush(stdout);
    return YES;
}
- (void)drawRect:(NSRect)r { [[NSColor magentaColor] setFill]; NSRectFill(self.bounds); }
@end
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        double x = atof(argv[1]), y = atof(argv[2]), w = atof(argv[3]), h = atof(argv[4]);
        double sh = [[NSScreen screens][0] frame].size.height;
        NSWindow *win = [[NSWindow alloc] initWithContentRect:NSMakeRect(x, sh - y - h, w, h) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        [win setLevel:NSFloatingWindowLevel];
        SinkView *v = [[SinkView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
        [v registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
        [win setContentView:v];
        [win orderFrontRegardless];
        printf("READY\n"); fflush(stdout);
        [app run];
    }
    return 0;
}
