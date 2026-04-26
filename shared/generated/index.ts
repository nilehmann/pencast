import * as __typia_transform__assertGuard from "typia/lib/internal/_assertGuard";
import type { AnnotationStroke } from "../types.js";
export const assertAnnotationSlide = (() => { const _iv2 = new Set(["ink", "highlighter", "arrow", "line", "box", "ellipse", "perfect-circle", "eraser", "select", "pointer"]); const _av5 = new Set(["ink", "highlighter", "arrow", "line", "box", "ellipse", "perfect-circle", "eraser", "select", "pointer"]); const _io0 = (input: any): boolean => "string" === typeof input.id && true === _iv2.has(input.tool) && ("blue" === input.color || "orange" === input.color || "red" === input.color || "green" === input.color || "yellow" === input.color || "black" === input.color || "gray" === input.color) && ("thin" === input.thickness || "medium" === input.thickness || "thick" === input.thickness) && (Array.isArray(input.points) && input.points.every((elem: any) => "object" === typeof elem && null !== elem && _io1(elem))) && (undefined === input.rotation || "number" === typeof input.rotation); const _io1 = (input: any): boolean => "number" === typeof input.normX && "number" === typeof input.normY && (undefined === input.pressure || "number" === typeof input.pressure); const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("string" === typeof input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "string",
    value: input.id
}, _errorFactory)) && (true === _av5.has(input.tool) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tool",
    expected: "(\"arrow\" | \"box\" | \"ellipse\" | \"eraser\" | \"highlighter\" | \"ink\" | \"line\" | \"perfect-circle\" | \"pointer\" | \"select\")",
    value: input.tool
}, _errorFactory)) && ("blue" === input.color || "orange" === input.color || "red" === input.color || "green" === input.color || "yellow" === input.color || "black" === input.color || "gray" === input.color || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".color",
    expected: "(\"black\" | \"blue\" | \"gray\" | \"green\" | \"orange\" | \"red\" | \"yellow\")",
    value: input.color
}, _errorFactory)) && ("thin" === input.thickness || "medium" === input.thickness || "thick" === input.thickness || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".thickness",
    expected: "(\"medium\" | \"thick\" | \"thin\")",
    value: input.thickness
}, _errorFactory)) && ((Array.isArray(input.points) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".points",
    expected: "Array<NormalizedPoint>",
    value: input.points
}, _errorFactory)) && input.points.every((elem: any, _index6: number) => ("object" === typeof elem && null !== elem || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".points[" + _index6 + "]",
    expected: "NormalizedPoint",
    value: elem
}, _errorFactory)) && _ao1(elem, _path + ".points[" + _index6 + "]", true && _exceptionable) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".points[" + _index6 + "]",
    expected: "NormalizedPoint",
    value: elem
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".points",
    expected: "Array<NormalizedPoint>",
    value: input.points
}, _errorFactory)) && (undefined === input.rotation || "number" === typeof input.rotation || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".rotation",
    expected: "(number | undefined)",
    value: input.rotation
}, _errorFactory)); const _ao1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.normX || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".normX",
    expected: "number",
    value: input.normX
}, _errorFactory)) && ("number" === typeof input.normY || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".normY",
    expected: "number",
    value: input.normY
}, _errorFactory)) && (undefined === input.pressure || "number" === typeof input.pressure || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".pressure",
    expected: "(number | undefined)",
    value: input.pressure
}, _errorFactory)); const __is = (input: any): input is AnnotationStroke[] => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): AnnotationStroke[] => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => (Array.isArray(input) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "Array<AnnotationStroke>",
            value: input
        }, _errorFactory)) && input.every((elem: any, _index4: number) => ("object" === typeof elem && null !== elem || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "[" + _index4 + "]",
            expected: "AnnotationStroke",
            value: elem
        }, _errorFactory)) && _ao0(elem, _path + "[" + _index4 + "]", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "[" + _index4 + "]",
            expected: "AnnotationStroke",
            value: elem
        }, _errorFactory)) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "Array<AnnotationStroke>",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; })();
