import typia from "typia";
import type { AnnotationStroke } from "@pencast/shared/types";

export const assertAnnotationSlide = typia.createAssert<AnnotationStroke[]>();
