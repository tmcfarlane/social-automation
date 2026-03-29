import type { TweetCard, FilterCriteria, SkillResult } from "../types";

/**
 * Filter a list of X tweet cards by engagement and content criteria.
 * Returns tweets sorted by total engagement descending.
 */
export function findTargetTweet(
  tweets: TweetCard[],
  criteria: FilterCriteria = {}
): SkillResult<TweetCard[]> {
  try {
    const { minEngagement = 0, maxAgeHours, keywords = [], excludeKeywords = [] } = criteria;

    let filtered = tweets.filter((tweet) => {
      const totalEngagement = tweet.likes + tweet.retweets + tweet.replies;

      if (totalEngagement < minEngagement) return false;

      if (maxAgeHours && tweet.timestamp) {
        const tweetDate = new Date(tweet.timestamp);
        if (!isNaN(tweetDate.getTime())) {
          const ageHours = (Date.now() - tweetDate.getTime()) / 3_600_000;
          if (ageHours > maxAgeHours) return false;
        }
      }

      const contentLower = tweet.content.toLowerCase();

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

    filtered.sort(
      (a, b) =>
        b.likes + b.retweets + b.replies - (a.likes + a.retweets + a.replies)
    );

    return { success: true, data: filtered };
  } catch (err) {
    return {
      success: false,
      error: `Failed to filter tweets: ${String(err)}`,
    };
  }
}
