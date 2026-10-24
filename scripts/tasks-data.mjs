/**
 * Clone WebBrain — 30-day Facebook automation task catalogue.
 * Used by scripts/seed.mjs. Each task is executed by the AI agent through the
 * WebBrain MCP server, then marked done via PATCH /api/tasks/:day.
 */
export const TASKS = [
  {
    day: 1,
    title: 'Publish an organic farming introduction post',
    prompt: 'Write and publish a post about organic farming on the Facebook page.',
    details:
      '3-4 friendly sentences about organic practices, soil health and chemical-free produce. Include 3 relevant hashtags and one call to action ("Message us for this week\'s harvest"). Post as the page, not the personal profile.'
  },
  {
    day: 2,
    title: 'Update the profile bio',
    prompt: "Update the profile bio to 'Sustainable Farmer'.",
    details:
      'Open the page profile edit panel, set the bio/intro to "Sustainable Farmer", keep the category and contact details unchanged, save and verify the change is visible.'
  },
  {
    day: 3,
    title: 'Reply to the latest comment',
    prompt: 'Reply to the latest comment on the page with a helpful farming tip.',
    details:
      'Read the newest comment, answer the specific question or thank the person, then add one practical tip (composting, watering, pest control). Keep it under 60 words and friendly.'
  },
  {
    day: 4,
    title: 'Share a farm photo with a caption',
    prompt: 'Post a recent farm photo with an engaging caption.',
    details:
      'Use an existing photo from the page album (do not upload new third-party images). Caption: what is in the photo, why it matters, and a question for followers. 2-3 hashtags.'
  },
  {
    day: 5,
    title: 'Run a crop poll',
    prompt: 'Create a Facebook poll asking followers which crop to plant next season.',
    details:
      'Options: tomatoes, peppers, lettuce, herbs. Add a short intro sentence explaining the poll. Leave it open for one week if the option is available.'
  },
  {
    day: 6,
    title: 'Follow 10 relevant agriculture pages',
    prompt: 'Follow 10 relevant agriculture, organic farming or local food pages.',
    details:
      'Choose pages with real activity in the last 30 days. Avoid competitors in the same town. Do not comment or message them; just follow and note the page names.'
  },
  {
    day: 7,
    title: 'Engage with 5 local farmer posts',
    prompt: 'Like and leave a genuine comment on 5 recent posts from local farmers.',
    details:
      'Comments must be specific to the post content (no emojis-only, no links). 1-2 sentences each. Spread the actions with 3-6 second pauses.'
  },
  {
    day: 8,
    title: 'Post a short farm routine video',
    prompt: 'Post a short video or reel showing the daily farm routine.',
    details:
      'Use an existing video asset only. Caption should describe the routine and invite followers to ask questions. Add a location tag if available.'
  },
  {
    day: 9,
    title: 'Refresh the cover photo',
    prompt: 'Update the page cover photo with a seasonal harvest image.',
    details:
      'Use an image already owned by the page. Check that text and the profile picture do not cover key elements. Save and confirm the new cover renders on desktop and mobile.'
  },
  {
    day: 10,
    title: 'Clear the Messenger inbox',
    prompt: 'Respond to every unanswered Messenger message from the page inbox.',
    details:
      'Answer pricing and availability questions with the current offer. For anything you cannot answer, reply that the owner will follow up within 24 hours. Never promise a discount.'
  },
  {
    day: 11,
    title: 'Post a customer testimonial',
    prompt: 'Publish a customer testimonial as a post.',
    details:
      'Only use a review or message the customer already made public, or that is in the provided assets. Blur personal data. Thank the customer by first name only.'
  },
  {
    day: 12,
    title: 'Create a farm open-day event',
    prompt: 'Create a Facebook event for the next farm open day.',
    details:
      'Title: "Clone WebBrain Farm Open Day". Add date, time, address placeholder and a short description of what visitors will see. Set privacy to Public and publish.'
  },
  {
    day: 13,
    title: 'Share 5 composting tips',
    prompt: 'Publish a carousel-style post with 5 composting tips.',
    details:
      'Numbered tips, one line each, practical for home gardeners. If carousel creation is unavailable, publish a single text post with a numbered list.'
  },
  {
    day: 14,
    title: 'Thank partner suppliers',
    prompt: 'Post a thank-you message tagging partner suppliers.',
    details:
      'Tag only pages the farm actually works with. Mention what each partner supplies. Keep it under 80 words and avoid tagging more than 3 pages.'
  },
  {
    day: 15,
    title: 'Review page insights',
    prompt: 'Open Facebook page insights and record the top-performing post of the last 7 days.',
    details:
      'Note reach, engagement and the post link in the task report. Do not change any post. This task is read-only on Facebook and can be marked done after recording the numbers.'
  },
  {
    day: 16,
    title: 'Invite followers to ask questions',
    prompt: 'Post a Q&A invitation asking followers for their farming questions.',
    details:
      'Explain that the best questions will be answered in a follow-up post this week. Ask people to comment rather than message, to keep answers public.'
  },
  {
    day: 17,
    title: 'Share a weather-prep checklist',
    prompt: 'Post a short checklist to help followers prepare crops for changing weather.',
    details:
      '5 bullet points covering watering, mulch, wind protection, harvest timing and storage. Mention that the advice is general, not professional agronomy advice.'
  },
  {
    day: 18,
    title: 'Comment in farming groups',
    prompt: 'Leave 10 helpful comments in relevant farming groups.',
    details:
      'Only groups the page has already joined and where self-promotion is allowed. Answer the question asked; no links to the page unless explicitly requested. Vary wording.'
  },
  {
    day: 19,
    title: 'Post a behind-the-scenes harvest story',
    prompt: "Publish a behind-the-scenes story about this week's harvest.",
    details:
      'Mention what was harvested, how it was handled and where it goes. Add one photo from the page album. Keep the tone personal and honest.'
  },
  {
    day: 20,
    title: 'Update the About section',
    prompt: 'Update the page About section with services, opening hours and contact details.',
    details:
      'Use the details already published on the website. Do not invent an address or phone number. Keep the description under 255 characters where the field requires it.'
  },
  {
    day: 21,
    title: 'Pin the best-performing post',
    prompt: 'Pin the best-performing post of the month to the top of the page.',
    details:
      'Find the post with the highest engagement from insights, then use "Pin post". Unpin the previous pinned post if one exists. Verify the pin is visible.'
  },
  {
    day: 22,
    title: 'Announce a produce box offer',
    prompt: 'Post a limited-time offer for weekly produce boxes.',
    details:
      'Include what is in the box, price, delivery area and deadline. Use the current price list only. Add "while stocks last" and a clear ordering instruction.'
  },
  {
    day: 23,
    title: 'Reply to all page reviews',
    prompt: 'Reply to every unanswered review on the page.',
    details:
      'Thank positive reviews by name. For negative reviews, apologise, stay factual, and invite the person to message the page. Never argue or offer refunds without approval.'
  },
  {
    day: 24,
    title: 'Introduce the team',
    prompt: 'Publish a "meet the team" post with a photo and short introduction.',
    details:
      'Use an existing team photo. One or two sentences per person, first names only. Ask followers to say hello in the comments.'
  },
  {
    day: 25,
    title: 'Teach soil health basics',
    prompt: 'Post an educational explainer about soil health.',
    details:
      'Cover organic matter, cover crops and crop rotation in plain language. 120-180 words. End with one action followers can take this week.'
  },
  {
    day: 26,
    title: 'Launch a caption contest',
    prompt: 'Announce a caption contest with a clear prize and deadline.',
    details:
      'Use a farm photo already on the page. Prize must be something the farm actually offers (e.g. one produce box). State the deadline, how the winner is chosen, and that Facebook is not affiliated.'
  },
  {
    day: 27,
    title: 'Cross-post to Instagram',
    prompt: 'Cross-post the strongest Facebook post from this week to Instagram.',
    details:
      'Only if the Instagram account is already linked to the page. Adapt hashtags for Instagram, keep the same image and core message, then confirm both posts exist.'
  },
  {
    day: 28,
    title: 'Clean up outdated posts',
    prompt: 'Archive or delete expired offers and duplicate posts.',
    details:
      'Review posts older than 60 days that mention a price or deadline. Archive rather than delete when unsure. Never remove reviews, testimonials or customer conversations.'
  },
  {
    day: 29,
    title: 'Publish a monthly recap',
    prompt: 'Post a monthly recap with photos, highlights and key numbers.',
    details:
      'Include 3 highlights, 2 photos and one thank-you to customers. Numbers must come from page insights, not invented. End with a teaser for next month.'
  },
  {
    day: 30,
    title: 'Draft next month content calendar',
    prompt: "Create next month's content calendar and save it as a Facebook draft or note.",
    details:
      'Plan 3 posts per week with topic, format and target date. Do not schedule posts without approval; save the plan as a draft note and report the topics in the task summary.'
  }
];

export default TASKS;
