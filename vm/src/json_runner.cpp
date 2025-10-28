// Refactored: use shared JSONBytecodeLoader
#include <iostream>
#include <string>
#include "vm.h"
#include "dap.h"
#include "json_bytecode_loader.h"

void print_usage(const char* program_name) {
    std::cout << "Usage: " << program_name << " [options] <file.vmbc>" << std::endl;
    std::cout << "Loads and executes JSON bytecode format for the Doof VM" << std::endl;
    std::cout << "Options:" << std::endl;
    std::cout << "  --verbose    Enable verbose output for debugging" << std::endl;
    std::cout << "  --dap        Run in Debug Adapter Protocol mode (stdin/stdout)" << std::endl;
}

int main(int argc, char* argv[]) {
    bool verbose = false;
    bool dap_mode = false;
    std::string filename;
    
    // Parse command line arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--verbose") {
            verbose = true;
        } else if (arg == "--dap") {
            dap_mode = true;
        } else if (arg.substr(0, 2) == "--") {
            std::cerr << "Unknown option: " << arg << std::endl;
            print_usage(argv[0]);
            return 1;
        } else {
            if (filename.empty()) {
                filename = arg;
            } else {
                std::cerr << "Multiple files specified" << std::endl;
                print_usage(argv[0]);
                return 1;
            }
        }
    }

    if (filename.empty()) {
        print_usage(argv[0]);
        return 1;
    }

    DoofVM vm;

    try {
        if (verbose) {
            std::cout << "Loading bytecode from: " << filename << std::endl;
        }
        
        // Load the bytecode
        auto bytecode = JSONBytecodeLoader::load_from_file(filename);
        
        if (verbose) {
            std::cout << "Loaded " << bytecode.instructions.size() << " instructions" << std::endl;
            std::cout << "Loaded " << bytecode.constants.size() << " constants" << std::endl;
            std::cout << "Entry point: " << bytecode.entryPoint << std::endl;
            
            // Print constants if verbose
            if (!bytecode.constants.empty()) {
                std::cout << "Constants:" << std::endl;
                for (size_t i = 0; i < bytecode.constants.size(); ++i) {
                    std::cout << "  [" << i << "] ";
                    const auto& constant = bytecode.constants[i];
                    switch (constant.type()) {
                        case ValueType::Null:
                            std::cout << "null";
                            break;
                        case ValueType::Bool:
                            std::cout << "bool: " << (constant.as_bool() ? "true" : "false");
                            break;
                        case ValueType::Int:
                            std::cout << "int: " << constant.as_int();
                            break;
                        case ValueType::Float:
                            std::cout << "float: " << constant.as_float();
                            break;
                        case ValueType::Double:
                            std::cout << "double: " << constant.as_double();
                            break;
                        case ValueType::String:
                            std::cout << "string: \"" << constant.as_string() << "\"";
                            break;
                        default:
                            std::cout << "[complex type]";
                            break;
                    }
                    std::cout << std::endl;
                }
            }
            
            std::cout << "Starting execution..." << std::endl;
            std::cout << "---" << std::endl;
        }

        // Configure VM
        if (verbose && !dap_mode) {
            // Only enable verbose output when not in DAP mode
            // DAP mode uses stdout for protocol messages
            vm.set_verbose(true);
        }
        
        if (dap_mode) {
            // Run in DAP mode
            if (bytecode.hasDebugInfo) {
                vm.setDebugMode(true);
                vm.getDebugState().setDebugInfo(bytecode.debugInfo);
            }
            
            // Load bytecode into VM but don't start execution yet
            // The DAP handler will control execution
            
            // Create DAP handler and run the protocol loop
            DAPHandler dap(&vm);
            // Set the DAP handler in the VM for println redirection
            vm.setDAPHandler(&dap);
            // Set the bytecode for the DAP handler
            dap.setBytecode(bytecode.instructions, bytecode.constants, 
                           bytecode.entryPoint, bytecode.globalCount);
            dap.run();
        } else {
            // Normal execution mode
            if (bytecode.hasDebugInfo) {
                vm.run_with_debug(bytecode.instructions, bytecode.constants, bytecode.debugInfo, 
                                 bytecode.entryPoint, bytecode.globalCount);
            } else {
                vm.run(bytecode.instructions, bytecode.constants, bytecode.entryPoint, bytecode.globalCount);
            }
        }

        // Get and display result
        if (verbose) {
            std::cout << "---" << std::endl;
            std::cout << "Execution completed" << std::endl;
        }
        
    } catch (const std::bad_variant_access& e) {
        std::cerr << "Error: bad_variant_access - " << e.what() << std::endl;
        vm.dump_state(std::cerr);
        return 1;
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        vm.dump_state(std::cerr);
        return 1;
    }

    return 0;
}
