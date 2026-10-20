// Globals for the Ableton MCP Bridge v8ui script (ableton_mcp_lom.js).

// @types/maxmsp declares LiveAPI.call(func, args): void, but
// call takes any number of arguments (including none) and returns the LOM result.
// Declared as a subtype here because merging a second overload into LiveAPI still
// resolves to the void one.
interface LomApi extends LiveAPI {
    call(func: string, ...args: any[]): any;
}
