<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require_admin();

$rows = submissions()->all();

render_header('Submissions');
?>
<main class="shell wide">
  <div class="topbar">
    <h1>Submissions</h1>
    <form method="post" action="/logout.php">
      <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
      <button type="submit" class="secondary">Sign out</button>
    </form>
  </div>

  <?php if ($rows === []): ?>
    <section class="panel"><p>No submissions yet.</p></section>
  <?php else: ?>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>Name</th>
            <th>Email</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $row): ?>
            <tr>
              <td><?= e($row['created_at']) ?></td>
              <td><?= e($row['name']) ?></td>
              <td><a href="mailto:<?= e($row['email']) ?>"><?= e($row['email']) ?></a></td>
              <td><?= nl2br(e($row['message'])) ?></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </section>
  <?php endif; ?>
</main>
<?php render_footer(); ?>
