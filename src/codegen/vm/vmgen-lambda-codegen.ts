import { LambdaExpression, TrailingLambdaExpression, Identifier, CallExpression, CapturedBinding } from '../../types';
import { CompilationContext, NormalizedLambdaInfo, VMFunctionMetadata, VMValue } from "../vmgen";
import { addConstant, emit } from "./vmgen-emit";
import { generateCallExpression, generateExpressionOptimal } from "./vmgen-expression-codegen";

export function generateLambdaExpression(lambda: LambdaExpression, targetReg: number, context: CompilationContext): void {
    // Use the unified lambda creation helper
    const lambdaInfo = getNormalizedLambdaInfo(lambda);
    createLambdaObject(lambdaInfo, lambda, targetReg, context);
}

export function generateTrailingLambdaExpression(trailingLambda: TrailingLambdaExpression, targetReg: number, context: CompilationContext): void {
    // For trailing lambdas, we need to create a lambda and pass it as the last argument to the call

    // First, create the lambda
    const lambdaReg = context.registerAllocator.allocate();

    // Use the unified lambda creation helper
    const lambdaInfo = getNormalizedLambdaInfo(trailingLambda);
    createLambdaObject(lambdaInfo, trailingLambda, lambdaReg, context);

    // Generate the actual call with the lambda as an additional argument
    generateTrailingLambdaCall(trailingLambda, lambdaReg, targetReg, context);

    context.registerAllocator.free(lambdaReg);
}

// Helper method to extract normalized lambda information
export function getNormalizedLambdaInfo(lambda: LambdaExpression | TrailingLambdaExpression): NormalizedLambdaInfo {
    if (lambda.kind === 'lambda') {
        return {
            captureInfo: lambda.captureInfo,
            parameters: lambda.parameters,
            body: lambda.body,
            isBlock: lambda.body.kind === 'block',
            lambdaType: 'lambda'
        };
    } else {
        // TrailingLambdaExpression
        return {
            captureInfo: lambda.lambda.captureInfo,
            parameters: lambda.lambda.parameters || [],
            body: lambda.lambda.body,
            isBlock: lambda.lambda.isBlock && lambda.lambda.body.kind === 'block',
            lambdaType: 'trailing'
        };
    }
}

export function shouldCaptureByValue(_capture: CapturedBinding, _context: CompilationContext): boolean {
    // Reference captures are no longer supported; always capture by value.
    return true;
}

// Helper method for common lambda creation logic
function createLambdaObject(lambdaInfo: NormalizedLambdaInfo, lambda: LambdaExpression | TrailingLambdaExpression, targetReg: number, context: CompilationContext): { metadata: VMFunctionMetadata, createInstructionIndex: number } {
    // Create lambda metadata
    const namePrefix = lambdaInfo.lambdaType === 'lambda' ? 'lambda' : 'trailing_lambda';
    const metadata: VMFunctionMetadata = {
        name: `<${namePrefix}_${context.labelCounter++}>`,
        parameterCount: lambdaInfo.parameters.length,
        registerCount: 256, // Will be calculated after generation
        codeIndex: -1 // Will be set when body is generated
    };

    // Create FunctionMetadata for the lambda and add to constant pool
    const functionMetadata: VMFunctionMetadata = {
        name: metadata.name,
        parameterCount: lambdaInfo.parameters.length,
        registerCount: metadata.registerCount,
        codeIndex: -1 // Will be set when body is generated
    };

    const metadataValue: VMValue = {
        type: 'function',
        value: functionMetadata
    };
    const metadataIndex = addConstant(metadataValue, context);

    // Create the lambda object using constant pool reference
    const createInstructionIndex = context.instructions.length;
    emit('CREATE_LAMBDA', targetReg, Math.floor(metadataIndex / 256), metadataIndex % 256, context);

    // Handle captures if present
    if (lambdaInfo.captureInfo && lambdaInfo.captureInfo.capturedVariables.length > 0) {
        generateLambdaCaptures(lambdaInfo, targetReg, context);
    }

    // Store lambda for deferred generation
    if (!context.deferredLambdas) {
        context.deferredLambdas = [];
    }
    context.deferredLambdas.push({
        lambda,
        metadata,
        createInstructionIndex,
        metadataIndex // Store the constant pool index so we can update the code index later
    });

    return { metadata, createInstructionIndex };
}

function generateTrailingLambdaCall(trailingLambda: TrailingLambdaExpression, lambdaReg: number, targetReg: number, context: CompilationContext): void {
    // Convert trailing lambda to a regular call with the lambda as the last argument
    const allArgs = [...trailingLambda.arguments];

    // Create a temporary identifier expression for the lambda
    const lambdaIdentifier: Identifier = {
        kind: 'identifier',
        name: '<lambda_temp>',
        location: trailingLambda.location
    };

    // Map the lambda register to a temporary identifier
    (context.registerAllocator as any).variableRegisters.set('<lambda_temp>', lambdaReg);

    allArgs.push(lambdaIdentifier);

    // Create a synthetic call expression
    const syntheticCall: CallExpression = {
        kind: 'call',
        callee: trailingLambda.callee,
        arguments: allArgs,
        location: trailingLambda.location
    };

    // Generate the call
    generateCallExpression(syntheticCall, targetReg, context);

    // Clean up temporary mapping
    (context.registerAllocator as any).variableRegisters.delete('<lambda_temp>');
}

function generateLambdaCaptures(lambdaInfo: NormalizedLambdaInfo, lambdaReg: number, context: CompilationContext): void {
    if (!lambdaInfo.captureInfo) return;
    
    for (const capture of lambdaInfo.captureInfo.capturedVariables) {
        const captureReg = context.registerAllocator.getVariable(capture.name);
        if (captureReg === undefined) {
            // Variable not found in current scope, skip
            continue;
        }

        if (shouldCaptureByValue(capture, context)) {
            emit('CAPTURE_VALUE', lambdaReg, captureReg, 0, context);
        }
    }
}

export function generateLambdaInvocation(lambdaReg: number, args: any[], targetReg: number, context: CompilationContext): void {
    if (args.length === 0) {
        // No arguments - simple lambda invocation
        emit('INVOKE_LAMBDA', 0, lambdaReg, 0, context);
    } else {
        // Find a safe register to temporarily store the lambda if it conflicts with arguments
        let safeLambdaReg = lambdaReg;
        const argStartReg = 0; // Arguments start at r0

        // If the lambda register conflicts with argument registers, move it
        if (lambdaReg >= argStartReg && lambdaReg < argStartReg + args.length) {
            safeLambdaReg = context.registerAllocator.allocate();
            emit('MOVE', safeLambdaReg, lambdaReg, 0, context);
        }

        // Generate arguments into consecutive registers starting from r0
        for (let i = 0; i < args.length; i++) {
            const argAllocatedRegs: number[] = [];
            const sourceReg = generateExpressionOptimal(args[i], argAllocatedRegs, context);

            if (sourceReg !== argStartReg + i) {
                emit('MOVE', argStartReg + i, sourceReg, 0, context);
            }

            for (const reg of argAllocatedRegs) {
                if (reg !== argStartReg + i) {
                    context.registerAllocator.free(reg);
                }
            }
        }

        // Call INVOKE_LAMBDA with argument start register
        emit('INVOKE_LAMBDA', argStartReg, safeLambdaReg, 0, context);

        // Free the temporary lambda register if we allocated one
        if (safeLambdaReg !== lambdaReg) {
            context.registerAllocator.free(safeLambdaReg);
        }
    }

    // The result will be in r0 of the current frame after the lambda returns
    // Move it to the target register if different
    if (targetReg !== 0) {
        emit('MOVE', targetReg, 0, 0, context);
    }
}

export function isIdentifierCaptured(identifier: Identifier, lambda: LambdaExpression | TrailingLambdaExpression): boolean {
    const captureInfo = lambda.kind === 'lambda' ? lambda.captureInfo : lambda.lambda.captureInfo;
    if (!captureInfo) return false;

    return captureInfo.capturedVariables.some(capture => capture.name === identifier.name);
}
