#pragma once
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>

// Forward declarations
class DoofVM;

// Source map entry linking instruction to source location
struct SourceMapEntry {
    int instructionIndex;
    int sourceLine;
    int sourceColumn;
    int fileIndex;
};

// Debug information for functions
struct DebugFunctionInfo {
    std::string name;
    int startInstruction;
    int endInstruction;
    int fileIndex;
    int sourceLine;
    int sourceColumn;
    int parameterCount;
    int localVariableCount;
};

// Variable location types
enum class VariableLocationType {
    Register,
    Global,
    Constant
};

// Variable location information
struct VariableLocation {
    VariableLocationType type;
    int index;
};

// Debug information for variables
struct DebugVariableInfo {
    std::string name;
    std::string type;
    int startInstruction;
    int endInstruction;
    VariableLocation location;
};

// Debug scope information
struct DebugScopeInfo {
    int startInstruction;
    int endInstruction;
    int parentScopeIndex; // -1 for root scope
    std::vector<int> variableIndices;
};

// Debug file information
struct DebugFileInfo {
    std::string path;
    std::string content; // Optional source content
};

// Complete debug information package
struct DebugInfo {
    std::vector<SourceMapEntry> sourceMap;
    std::vector<DebugFunctionInfo> functions;
    std::vector<DebugVariableInfo> variables;
    std::vector<DebugScopeInfo> scopes;
    std::vector<DebugFileInfo> files;
};

// Breakpoint management
struct Breakpoint {
    int instructionIndex;
    int sourceLine;
    int fileIndex;
    bool enabled;
    std::string condition; // Optional conditional breakpoint
};

// Stepping modes
enum class StepMode {
    None,
    StepIn,
    StepOver,
    StepOut
};

// Debug state for DAP support
class DebugState {
public:
    DebugState();
    
    // Debug information
    void setDebugInfo(const DebugInfo& info);
    const DebugInfo& getDebugInfo() const { return debugInfo_; }
    bool hasDebugInfo() const { return hasDebugInfo_; }
    
    // Breakpoint management
    int addBreakpoint(int sourceLine, int fileIndex, const std::string& condition = "");
    bool removeBreakpoint(int breakpointId);
    void enableBreakpoint(int breakpointId, bool enabled);
    void clearBreakpoints();
    bool hasBreakpointAtInstruction(int instructionIndex) const;
    std::vector<Breakpoint> getBreakpoints() const;
    
    // Source mapping
    int getInstructionFromSource(int sourceLine, int fileIndex) const;
    SourceMapEntry getSourceFromInstruction(int instructionIndex) const;
    
    // Function information
    const DebugFunctionInfo* getFunctionAtInstruction(int instructionIndex) const;
    std::vector<DebugFunctionInfo> getAllFunctions() const;
    
    // Variable information
    std::vector<DebugVariableInfo> getVariablesInScope(int instructionIndex) const;
    const DebugVariableInfo* getVariableByName(const std::string& name, int instructionIndex) const;
    
    // Stepping control
    void setStepMode(StepMode mode) { stepMode_ = mode; }
    StepMode getStepMode() const { return stepMode_; }
    bool shouldBreakOnStep(int currentInstruction, int callDepth) const;
    
    // Call stack tracking for step over/out
    void setStepOverDepth(int depth) { stepOverDepth_ = depth; }
    void setStepOutDepth(int depth) { stepOutDepth_ = depth; }
    
    // Line tracking for stepping
    void setStepFromLine(int line, int fileIndex) { lastStepLine_ = line; lastStepFileIndex_ = fileIndex; }
    
private:
    DebugInfo debugInfo_;
    bool hasDebugInfo_;
    std::vector<Breakpoint> breakpoints_;
    std::unordered_set<int> instructionBreakpoints_; // Fast lookup
    int nextBreakpointId_;
    
    // Stepping state
    StepMode stepMode_;
    int stepOverDepth_;
    int stepOutDepth_;
    int lastStepLine_;      // Track last line we stepped from
    int lastStepFileIndex_; // Track file of last step
    
    void updateInstructionBreakpoints();
};