import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Import types from generated client
import type { ExerciseTemplate } from "../generated/client/types/index.js";
import { withErrorHandling } from "../utils/error-handler.js";
import {
	getCacheStats,
	initializeCache,
	searchExercises,
} from "../utils/exerciseCache.js";
import { formatExerciseTemplate } from "../utils/formatters.js";
import {
	createEmptyResponse,
	createJsonResponse,
} from "../utils/response-formatter.js";

// Type definitions for the template operations
type HevyClient = ReturnType<
	typeof import("../utils/hevyClientKubb.js").createClient
>;

// Cache initialization flag
let cacheInitialized = false;

/**
 * Register all exercise template-related tools with the MCP server
 */
export function registerTemplateTools(
	server: McpServer,
	hevyClient: HevyClient,
) {
	// Initialize cache on first use
	const ensureCacheInitialized = async () => {
		if (!cacheInitialized) {
			console.error("[TemplateTools] Initializing exercise cache...");
			await initializeCache(hevyClient);
			cacheInitialized = true;
		}
	};

	// Search exercises (uses cached data)
	server.tool(
		"search-exercises",
		"Search through all available exercises using cached data. Supports fuzzy matching on exercise name, muscle groups, and type. Can filter by muscle group and exercise type. Returns matching exercises sorted by relevance.",
		{
			query: z.string().min(1).describe("Search query for exercise name"),
			muscleGroup: z
				.string()
				.optional()
				.describe("Filter by specific muscle group"),
			exerciseType: z.string().optional().describe("Filter by exercise type"),
			limit: z.coerce
				.number()
				.int()
				.gte(1)
				.lte(100)
				.default(20)
				.describe("Maximum number of results to return"),
		},
		withErrorHandling(
			async ({
				query,
				muscleGroup,
				exerciseType,
				limit,
			}: {
				query: string;
				muscleGroup?: string;
				exerciseType?: string;
				limit: number;
			}) => {
				// Ensure cache is initialized
				await ensureCacheInitialized();

				// Search exercises
				const results = searchExercises(query, {
					muscleGroup,
					exerciseType,
				});

				// Limit results
				const limitedResults = results.slice(0, limit);

				if (limitedResults.length === 0) {
					return createEmptyResponse(
						`No exercises found matching query: "${query}"`,
					);
				}

				// Format results
				const formattedResults = limitedResults.map((exercise) =>
					formatExerciseTemplate(exercise),
				);

				// Get cache stats for metadata
				const cacheStats = getCacheStats();

				return createJsonResponse({
					results: formattedResults,
					metadata: {
						total_results: results.length,
						displayed_results: limitedResults.length,
						query,
						filters: {
							muscle_group: muscleGroup || null,
							exercise_type: exerciseType || null,
						},
						cache_stats: {
							total_exercises: cacheStats.totalExercises,
							last_updated: cacheStats.lastUpdated,
							cache_age_hours: Math.round(
								cacheStats.cacheAge / (1000 * 60 * 60),
							),
						},
					},
				});
			},
			"search-exercises",
		),
	);

	// Get exercise templates
	server.tool(
		"get-exercise-templates",
		"Get a paginated list of exercise templates (default and custom) with details like name, category, equipment, and muscle groups. Useful for browsing or searching available exercises.",
		{
			page: z.coerce.number().int().gte(1).default(1),
			pageSize: z.coerce.number().int().gte(1).lte(100).default(5),
		},
		withErrorHandling(
			async ({ page, pageSize }: { page: number; pageSize: number }) => {
				const data = await hevyClient.getExerciseTemplates({
					page,
					pageSize,
				});

				// Process exercise templates to extract relevant information
				const templates =
					data?.exercise_templates?.map((template: ExerciseTemplate) =>
						formatExerciseTemplate(template),
					) || [];

				if (templates.length === 0) {
					return createEmptyResponse(
						"No exercise templates found for the specified parameters",
					);
				}

				return createJsonResponse(templates);
			},
			"get-exercise-templates",
		),
	);

	// Get single exercise template by ID
	server.tool(
		"get-exercise-template",
		"Get complete details of a specific exercise template by its ID, including name, category, equipment, muscle groups, and notes.",
		{
			exerciseTemplateId: z.string().min(1),
		},
		withErrorHandling(
			async ({ exerciseTemplateId }: { exerciseTemplateId: string }) => {
				const data = await hevyClient.getExerciseTemplate(exerciseTemplateId);

				if (!data) {
					return createEmptyResponse(
						`Exercise template with ID ${exerciseTemplateId} not found`,
					);
				}

				const template = formatExerciseTemplate(data);
				return createJsonResponse(template);
			},
			"get-exercise-template",
		),
	);
}
