<?php /** @var array $errors */ ?>
<?php if (!empty($errors)): ?>
    <div class="errors">
        <ul>
            <?php foreach ($errors as $err): ?>
                <li><?= e($err) ?></li>
            <?php endforeach; ?>
        </ul>
    </div>
<?php endif; ?>
