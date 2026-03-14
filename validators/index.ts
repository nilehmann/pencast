import typia from "typia";
import type { AnnotationStroke } from "../shared/types.js";

export const assertAnnotationSlide = typia.createAssert<AnnotationStroke[]>();
