#include "debug.h"
#include <algorithm>
#include <iostream>

DebugState::DebugState() 
    : hasDebugInfo_(false), nextBreakpointId_(1), stepMode_(StepMode::None), 
      stepOverDepth_(-1), stepOutDepth_(-1), lastStepLine_(-1), lastStepFileIndex_(-1) {
}

void DebugState::setDebugInfo(const DebugInfo& info) {
    debugInfo_ = info;
    hasDebugInfo_ = true;
}

int DebugState::addBreakpoint(int sourceLine, int fileIndex, const std::string& condition) {
    // Find instruction index for this source line
    int instructionIndex = getInstructionFromSource(sourceLine, fileIndex);
    if (instructionIndex == -1) {
        return -1; // Invalid source location
    }
    
    Breakpoint bp;
    bp.instructionIndex = instructionIndex;
    bp.sourceLine = sourceLine;
    bp.fileIndex = fileIndex;
    bp.enabled = true;
    bp.condition = condition;
    
    breakpoints_.push_back(bp);
    updateInstructionBreakpoints();
    
    return nextBreakpointId_++;
}

bool DebugState::removeBreakpoint(int breakpointId) {
    // Note: For simplicity, we're using the vector index as ID
    // In a real implementation, you'd want proper ID management
    if (breakpointId < 1 || breakpointId > static_cast<int>(breakpoints_.size())) {
        return false;
    }
    
    breakpoints_.erase(breakpoints_.begin() + (breakpointId - 1));
    updateInstructionBreakpoints();
    return true;
}

void DebugState::enableBreakpoint(int breakpointId, bool enabled) {
    if (breakpointId < 1 || breakpointId > static_cast<int>(breakpoints_.size())) {
        return;
    }
    
    breakpoints_[breakpointId - 1].enabled = enabled;
    updateInstructionBreakpoints();
}

bool DebugState::hasBreakpointAtInstruction(int instructionIndex) const {
    return instructionBreakpoints_.find(instructionIndex) != instructionBreakpoints_.end();
}

void DebugState::clearBreakpoints() {
    breakpoints_.clear();
    updateInstructionBreakpoints();
}

std::vector<Breakpoint> DebugState::getBreakpoints() const {
    return breakpoints_;
}

int DebugState::getInstructionFromSource(int sourceLine, int fileIndex) const {
    if (!hasDebugInfo_) return -1;
    
    // Find the first instruction at this source line
    for (const auto& entry : debugInfo_.sourceMap) {
        if (entry.sourceLine == sourceLine && entry.fileIndex == fileIndex) {
            return entry.instructionIndex;
        }
    }
    
    return -1;
}

SourceMapEntry DebugState::getSourceFromInstruction(int instructionIndex) const {
    if (!hasDebugInfo_) {
        return {-1, -1, -1, -1};
    }
    
    // Find the source map entry for this instruction
    for (const auto& entry : debugInfo_.sourceMap) {
        if (entry.instructionIndex == instructionIndex) {
            return entry;
        }
    }
    
    // If no exact match, find the closest previous instruction
    SourceMapEntry closest = {-1, -1, -1, -1};
    for (const auto& entry : debugInfo_.sourceMap) {
        if (entry.instructionIndex <= instructionIndex) {
            if (closest.instructionIndex == -1 || entry.instructionIndex > closest.instructionIndex) {
                closest = entry;
            }
        }
    }
    
    return closest;
}

const DebugFunctionInfo* DebugState::getFunctionAtInstruction(int instructionIndex) const {
    if (!hasDebugInfo_) return nullptr;
    
    for (const auto& func : debugInfo_.functions) {
        if (instructionIndex >= func.startInstruction && instructionIndex <= func.endInstruction) {
            return &func;
        }
    }
    
    return nullptr;
}

std::vector<DebugFunctionInfo> DebugState::getAllFunctions() const {
    if (!hasDebugInfo_) return {};
    return debugInfo_.functions;
}

std::vector<DebugVariableInfo> DebugState::getVariablesInScope(int instructionIndex) const {
    if (!hasDebugInfo_) return {};
    
    std::vector<DebugVariableInfo> result;
    
    for (const auto& var : debugInfo_.variables) {
        if (instructionIndex >= var.startInstruction && 
            (var.endInstruction == -1 || instructionIndex <= var.endInstruction)) {
            result.push_back(var);
        }
    }
    
    return result;
}

const DebugVariableInfo* DebugState::getVariableByName(const std::string& name, int instructionIndex) const {
    if (!hasDebugInfo_) return nullptr;
    
    for (const auto& var : debugInfo_.variables) {
        if (var.name == name && 
            instructionIndex >= var.startInstruction && 
            (var.endInstruction == -1 || instructionIndex <= var.endInstruction)) {
            return &var;
        }
    }
    
    return nullptr;
}

bool DebugState::shouldBreakOnStep(int currentInstruction, int callDepth) const {
    if (stepMode_ == StepMode::None) {
        return false;
    }
    
    // Get current source location
    SourceMapEntry currentLocation = getSourceFromInstruction(currentInstruction);
    if (currentLocation.sourceLine == -1) {
        return false; // No debug info available for this instruction
    }
    
    // If we haven't set a step-from line (stepping from entry), break at first source line
    if (lastStepLine_ == -1) {
        return true;
    }
    
    // Check if we've moved to a different line
    bool differentLine = (currentLocation.sourceLine != lastStepLine_ || 
                         currentLocation.fileIndex != lastStepFileIndex_);
    
    switch (stepMode_) {
        case StepMode::StepIn:
            // Break when we reach a different line
            return differentLine;
            
        case StepMode::StepOver:
            // Break when we reach a different line at same or shallower call depth
            return differentLine && (callDepth <= stepOverDepth_);
            
        case StepMode::StepOut:
            // Break when we reach a shallower call depth
            return callDepth < stepOutDepth_;
            
        default:
            return false;
    }
}

void DebugState::updateInstructionBreakpoints() {
    instructionBreakpoints_.clear();
    
    for (const auto& bp : breakpoints_) {
        if (bp.enabled) {
            instructionBreakpoints_.insert(bp.instructionIndex);
        }
    }
}