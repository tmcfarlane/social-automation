import type { Page } from "playwright";

export type { Page };

export interface PostCard {
  author: string;
  authorUrl: string;
  content: string;
  postUrl: string;
  likes: number;
  comments: number;
  reposts: number;
  timestamp: string;
}

export interface Comment {
  commenter: string;
  text: string;
  timestamp: string;
  likes: number;
}

export interface TweetCard {
  author: string;
  handle: string;
  content: string;
  tweetUrl: string;
  likes: number;
  retweets: number;
  replies: number;
  timestamp: string;
}

export interface SkillResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FilterCriteria {
  minEngagement?: number;
  maxAgeHours?: number;
  keywords?: string[];
  excludeKeywords?: string[];
}
