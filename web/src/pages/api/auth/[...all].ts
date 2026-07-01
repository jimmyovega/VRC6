import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";

// Forwards every /api/auth/* request to the better-auth handler.
export const ALL: APIRoute = ({ request }) => getAuth().handler(request);
