import { getTodayInTimezone } from '../utils/date';

/**
 * Seeds the initial 4-member family (2 parents, 2 children) and realistic starter
 * recurring templates only when the database is empty.
 */
export async function ensureSeeded(db: D1Database, timezone = 'Europe/Kyiv', initialAdminEmail?: string): Promise<void> {
  const existing = await db.prepare('SELECT COUNT(*) as count FROM members').first<{ count: number }>();
  if (existing && existing.count > 0) {
    return;
  }

  const today = getTodayInTimezone(timezone);
  const adminEmail = initialAdminEmail?.trim().toLowerCase() || null;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO members (id, name, role, email, avatar_emoji, accent_color, preferred_lang, sort_order, title_uk, title_en)
         VALUES (?, ?, ?, ?, ?, ?, 'uk', ?, ?, ?)`,
      )
      .bind('parent-1', 'Микола', 'parent', adminEmail, '🧭', 'forest', 1, 'Капітан дому', 'Home Captain'),
    db
      .prepare(
        `INSERT INTO members (id, name, role, email, avatar_emoji, accent_color, preferred_lang, sort_order, title_uk, title_en)
         VALUES (?, ?, ?, NULL, ?, ?, 'uk', ?, ?, ?)`,
      )
      .bind('parent-2', 'Танюша', 'parent', '🌿', 'terracotta', 2, 'Хранителька дому', 'Home Keeper'),
    db
      .prepare(
        `INSERT INTO members (id, name, role, email, avatar_emoji, accent_color, preferred_lang, sort_order, title_uk, title_en)
         VALUES (?, ?, ?, NULL, ?, ?, 'uk', ?, ?, ?)`,
      )
      .bind('child-1', 'Орест', 'child', '🦊', 'ocean', 3, 'Слідопит', 'Pathfinder'),
    db
      .prepare(
        `INSERT INTO members (id, name, role, email, avatar_emoji, accent_color, preferred_lang, sort_order, title_uk, title_en)
         VALUES (?, ?, ?, NULL, ?, ?, 'uk', ?, ?, ?)`,
      )
      .bind('child-2', 'Ясенʼяр', 'child', '🦉', 'amber', 4, 'Новачок', 'Rookie'),

    // Starter recurring templates for Child 1 (Orest)
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-orest-homework',
        'child-1',
        'Виконати домашнє завдання',
        'Перевірити всі предмети на завтра та скласти рюкзак',
        'school',
        1,
        'weekdays',
        null,
        null,
        today,
        25,
        1,
      ),
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-orest-exercises',
        'child-1',
        'Зробити зарядку / вправи',
        '15 хвилин активної розминки',
        'health',
        1,
        'daily',
        null,
        null,
        today,
        15,
        2,
      ),
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-orest-hamster',
        'child-1',
        'Поміняти підстилку хомʼяку',
        'Почистити клітку, насипати свіжу тирсу та оновити воду',
        'pet',
        1,
        'every_n_days',
        null,
        3,
        today,
        20,
        3,
      ),
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-orest-reading',
        'child-1',
        'Почитати книгу (20 хв)',
        'Додатковий квест для бонусу та досвіду',
        'extra',
        0,
        'daily',
        null,
        null,
        today,
        15,
        4,
      ),

    // Starter recurring templates for Child 2
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-child2-room',
        'child-2',
        'Прибрати іграшки та стіл',
        'Скласти речі на свої місця',
        'chores',
        1,
        'daily',
        null,
        null,
        today,
        15,
        1,
      ),
    db
      .prepare(
        `INSERT INTO task_templates
         (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent-1')`,
      )
      .bind(
        'tpl-child2-practice',
        'child-2',
        'Повчитися / читання 15 хв',
        'Щоденна маленька практика',
        'school',
        1,
        'daily',
        null,
        null,
        today,
        15,
        2,
      ),

    // Sample one-off task for Parent 1 (from transcript)
    db
      .prepare(
        `INSERT INTO tasks
         (id, template_id, assignee_id, task_date, title, description, category, is_mandatory, xp_value, status, completion_pct, created_by)
         VALUES (?, NULL, 'parent-1', ?, ?, ?, 'errands', 0, 10, 'todo', 0, 'parent-2')`,
      )
      .bind('task-seed-groceries', today, 'Сходити в магазин за продуктами', 'Хліб, молоко, фрукти для дітей'),
  ];

  await db.batch(statements);
}
