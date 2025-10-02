import type { ExerciseTemplate } from "../generated/client/types/index.js";

interface ExerciseCache {
	exercises: ExerciseTemplate[];
	lastUpdated: number;
	isInitialized: boolean;
}

const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const cache: ExerciseCache = {
	exercises: [],
	lastUpdated: 0,
	isInitialized: false,
};

/**
 * Initialize the exercise cache by fetching all pages of exercise templates
 */
export async function initializeCache(
	hevyClient: {
		getExerciseTemplates: (params: {
			page: number;
			pageSize: number;
		}) => Promise<{
			page_count?: number;
			exercise_templates?: ExerciseTemplate[];
		}>;
	},
	forceRefresh = false,
): Promise<void> {
	const now = Date.now();
	const cacheExpired = now - cache.lastUpdated > CACHE_TTL;

	if (cache.isInitialized && !cacheExpired && !forceRefresh) {
		console.error(
			`[ExerciseCache] Cache is fresh (${cache.exercises.length} exercises)`,
		);
		return;
	}

	console.error(
		"[ExerciseCache] Initializing cache by fetching all exercises...",
	);

	const allExercises: ExerciseTemplate[] = [];
	const pageSize = 100; // Use maximum page size for efficiency
	let currentPage = 1;
	let totalPages = 1;

	try {
		// Fetch first page to determine total pages
		const firstPageData = await hevyClient.getExerciseTemplates({
			page: currentPage,
			pageSize,
		});

		if (firstPageData.exercise_templates) {
			allExercises.push(...firstPageData.exercise_templates);
		}

		totalPages = firstPageData.page_count || 1;
		console.error(
			`[ExerciseCache] Found ${totalPages} pages of exercises to fetch`,
		);

		// Fetch remaining pages
		for (currentPage = 2; currentPage <= totalPages; currentPage++) {
			console.error(
				`[ExerciseCache] Fetching page ${currentPage} of ${totalPages}...`,
			);

			const pageData = await hevyClient.getExerciseTemplates({
				page: currentPage,
				pageSize,
			});

			if (pageData.exercise_templates) {
				allExercises.push(...pageData.exercise_templates);
			}

			// Add a small delay to avoid rate limiting
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Update cache
		cache.exercises = allExercises;
		cache.lastUpdated = Date.now();
		cache.isInitialized = true;

		console.error(
			`[ExerciseCache] Cache initialized with ${allExercises.length} exercises`,
		);
	} catch (error) {
		console.error("[ExerciseCache] Failed to initialize cache:", error);
		throw new Error(
			`Failed to initialize exercise cache: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Get all cached exercises
 */
export function getCachedExercises(): ExerciseTemplate[] {
	if (!cache.isInitialized) {
		throw new Error(
			"Exercise cache not initialized. Call initializeCache() first.",
		);
	}
	return cache.exercises;
}

/**
 * Common synonyms and aliases for exercise search
 */
const SEARCH_SYNONYMS: Record<string, string[]> = {
	db: ["dumbbell", "dumbell"],
	bb: ["barbell", "barbel"],
	machine: ["mach", "assisted"],
	cable: ["cables"],
	lat: ["lats", "lateral"],
	bi: ["bicep", "biceps"],
	tri: ["tricep", "triceps"],
	leg: ["legs"],
	chest: ["pec", "pecs", "pectoral"],
	back: ["lats", "rear"],
	shoulder: ["shoulders", "delt", "delts", "deltoid"],
};

/**
 * Expand query tokens with synonyms
 */
function expandTokensWithSynonyms(tokens: string[]): string[] {
	const expanded = [...tokens];
	for (const token of tokens) {
		// Check if this token has synonyms
		for (const [key, synonyms] of Object.entries(SEARCH_SYNONYMS)) {
			if (token === key || synonyms.includes(token)) {
				// Add the key and all synonyms
				expanded.push(key, ...synonyms);
			}
		}
	}
	// Remove duplicates
	return [...new Set(expanded)];
}

/**
 * Calculate search score for an exercise based on query tokens
 */
function calculateSearchScore(
	exercise: ExerciseTemplate,
	tokens: string[],
): number {
	const title = exercise.title?.toLowerCase() || "";
	const type = exercise.type?.toLowerCase() || "";
	const primaryMuscle = exercise.primary_muscle_group?.toLowerCase() || "";
	const secondaryMuscles =
		exercise.secondary_muscle_groups?.map((m) => m.toLowerCase()) || [];

	// Expand tokens with synonyms for better matching
	const expandedTokens = expandTokensWithSynonyms(tokens);
	const originalTokenCount = tokens.length;

	let score = 0;

	// Track which original tokens were matched (for scoring)
	const originalTokenMatches = new Set<string>();

	for (const token of expandedTokens) {
		const isOriginalToken = tokens.includes(token);

		// Title matches (highest priority)
		if (title.includes(token)) {
			if (isOriginalToken) {
				originalTokenMatches.add(token);
			}

			// Exact word boundary match
			const wordBoundaryRegex = new RegExp(`\\b${token}\\b`, "i");
			if (wordBoundaryRegex.test(title)) {
				score += isOriginalToken ? 100 : 60; // Original tokens score higher
			} else {
				score += isOriginalToken ? 50 : 30; // Partial match within word
			}

			// Bonus for position in title
			const position = title.indexOf(token);
			if (position === 0) {
				score += 30; // Starts with token
			} else if (position < 10) {
				score += 15; // Near beginning
			}
		}

		// Type matches
		if (type.includes(token)) {
			if (isOriginalToken) {
				originalTokenMatches.add(token);
			}
			score += isOriginalToken ? 40 : 25;
		}

		// Primary muscle group matches
		if (primaryMuscle.includes(token)) {
			if (isOriginalToken) {
				originalTokenMatches.add(token);
			}
			score += isOriginalToken ? 30 : 20;
		}

		// Secondary muscle group matches
		if (secondaryMuscles.some((muscle) => muscle.includes(token))) {
			if (isOriginalToken) {
				originalTokenMatches.add(token);
			}
			score += isOriginalToken ? 20 : 10;
		}
	}

	const matchedOriginalTokens = originalTokenMatches.size;

	// Penalty if not all original tokens matched
	if (matchedOriginalTokens < originalTokenCount) {
		score *= matchedOriginalTokens / originalTokenCount;
	}

	// Bonus for matching all original tokens
	if (matchedOriginalTokens === originalTokenCount && originalTokenCount > 1) {
		score += 50;
	}

	// Bonus for exact phrase match in title
	const fullQuery = tokens.join(" ");
	if (title.includes(fullQuery)) {
		score += 200;
	}

	return score;
}

/**
 * Search exercises by query string with advanced fuzzy matching
 */
export function searchExercises(
	query: string,
	options: {
		muscleGroup?: string;
		exerciseType?: string;
	} = {},
): ExerciseTemplate[] {
	if (!cache.isInitialized) {
		throw new Error(
			"Exercise cache not initialized. Call initializeCache() first.",
		);
	}

	const normalizedQuery = query.toLowerCase().trim();
	let results = cache.exercises;

	// Tokenize query into individual words for flexible matching
	if (normalizedQuery) {
		const tokens = normalizedQuery.split(/\s+/).filter((t) => t.length > 0);

		// Score each exercise
		const scoredResults = results.map((exercise) => ({
			exercise,
			score: calculateSearchScore(exercise, tokens),
		}));

		// Filter out exercises with zero score (no matches)
		results = scoredResults
			.filter((item) => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.map((item) => item.exercise);
	}

	// Filter by muscle group if provided
	if (options.muscleGroup) {
		const normalizedMuscleGroup = options.muscleGroup.toLowerCase();
		results = results.filter((exercise) => {
			const primaryMatch =
				exercise.primary_muscle_group?.toLowerCase() === normalizedMuscleGroup;
			const secondaryMatch = exercise.secondary_muscle_groups?.some(
				(muscle) => muscle.toLowerCase() === normalizedMuscleGroup,
			);
			return primaryMatch || secondaryMatch;
		});
	}

	// Filter by exercise type if provided
	if (options.exerciseType) {
		const normalizedType = options.exerciseType.toLowerCase();
		results = results.filter(
			(exercise) => exercise.type?.toLowerCase() === normalizedType,
		);
	}

	return results;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
	totalExercises: number;
	lastUpdated: Date | null;
	isInitialized: boolean;
	cacheAge: number;
} {
	return {
		totalExercises: cache.exercises.length,
		lastUpdated: cache.isInitialized ? new Date(cache.lastUpdated) : null,
		isInitialized: cache.isInitialized,
		cacheAge: cache.isInitialized ? Date.now() - cache.lastUpdated : 0,
	};
}

/**
 * Clear the cache
 */
export function clearCache(): void {
	cache.exercises = [];
	cache.lastUpdated = 0;
	cache.isInitialized = false;
	console.error("[ExerciseCache] Cache cleared");
}
