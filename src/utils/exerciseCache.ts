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
		console.log(
			`[ExerciseCache] Cache is fresh (${cache.exercises.length} exercises)`,
		);
		return;
	}

	console.log(
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
		console.log(
			`[ExerciseCache] Found ${totalPages} pages of exercises to fetch`,
		);

		// Fetch remaining pages
		for (currentPage = 2; currentPage <= totalPages; currentPage++) {
			console.log(
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

		console.log(
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
 * Search exercises by query string with fuzzy matching
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

	// Filter by query if provided
	if (normalizedQuery) {
		results = results.filter((exercise) => {
			const titleMatch = exercise.title
				?.toLowerCase()
				.includes(normalizedQuery);
			const primaryMuscleMatch = exercise.primary_muscle_group
				?.toLowerCase()
				.includes(normalizedQuery);
			const secondaryMuscleMatch = exercise.secondary_muscle_groups?.some(
				(muscle) => muscle.toLowerCase().includes(normalizedQuery),
			);
			const typeMatch = exercise.type?.toLowerCase().includes(normalizedQuery);

			return (
				titleMatch || primaryMuscleMatch || secondaryMuscleMatch || typeMatch
			);
		});
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

	// Sort by relevance (exact matches first, then partial matches)
	if (normalizedQuery) {
		results = results.sort((a, b) => {
			const aExactMatch = a.title?.toLowerCase() === normalizedQuery;
			const bExactMatch = b.title?.toLowerCase() === normalizedQuery;

			if (aExactMatch && !bExactMatch) return -1;
			if (!aExactMatch && bExactMatch) return 1;

			const aStartsWithMatch = a.title
				?.toLowerCase()
				.startsWith(normalizedQuery);
			const bStartsWithMatch = b.title
				?.toLowerCase()
				.startsWith(normalizedQuery);

			if (aStartsWithMatch && !bStartsWithMatch) return -1;
			if (!aStartsWithMatch && bStartsWithMatch) return 1;

			return 0;
		});
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
	console.log("[ExerciseCache] Cache cleared");
}
