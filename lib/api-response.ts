import { NextResponse } from "next/server";
import type { ApiError, ApiSuccess } from "@/types";

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(
  error: string,
  status = 400,
  field?: string
): NextResponse<ApiError> {
  const body: ApiError = { success: false, error };
  if (field) body.field = field;
  return NextResponse.json(body, { status });
}
