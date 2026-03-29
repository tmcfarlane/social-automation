import type { PostCard, FilterCriteria, SkillResult } from "../types";

/**
 * Filter a list of LinkedIn post cards by engagement and content criteria.
 * Returns posts sorted by total engagement descending.
 */
export function findTargetPost(
  posts: PostCard[],
  criteria: FilterCriteria = {}
): SkillResult<PostCard[]> {
  try {
    const { minEngagement = 0, maxAgeHours, keywords = [], excludeKeywords = [] } = criteria;

    let filtered = posts.filter((post) => {
      const totalEngagement = post.likes + post.comments + post.reposts;

      if (totalEngagement < minEngagement) return false;

      if (maxAgeHours && post.timestamp) {
        const postDate = new Date(post.timestamp);
        if (!isNaN(postDate.getTime())) {
          const ageHours = (Date.now() - postDate.getTime()) / 3_600_000;
          if (ageHours > maxAgeHours) return false;
        }
      }

      const contentLower = post.content.toLowerCase();

      if (
        keywords.length > 0 &&
        !keywords.some((kw) => contentLower.includes(kw.toLowerCase()))
      ) {
        return false;
      }

      if (
        excludeKeywords.some((kw) => contentLower.includes(kw.toLowerCase()))
      ) {
        return false;
      }

      return true;
    });

    // Sort by total engagement descending
    filtered.sort(
      (a, b) =>
        b.likes + b.comments + b.reposts - (a.likes + a.comments + a.reposts)
    );

    return { success: true, data: filtered };
  } catch (err) {
    return {
      success: false,
      error: `Failed to filter posts: ${String(err)}`,
    };
  }
}
