<?php
namespace App;
$maxMb = round(max_upload_bytes() / 1048576, 1);
?>
<h1>Upload an image</h1>

<form method="post" action="/upload" enctype="multipart/form-data" class="form">
    <?= csrf_field() ?>
    <label>
        Image file
        <input type="file" name="image"
               accept="image/jpeg,image/png,image/gif,image/webp" required>
        <small class="hint">JPEG, PNG, GIF or WebP. Max <?= e((string) $maxMb) ?> MB.</small>
    </label>
    <label>
        Caption
        <textarea name="caption" rows="3" maxlength="500"
                  placeholder="Describe your image (optional)"></textarea>
        <small class="hint">Up to 500 characters.</small>
    </label>
    <button type="submit">Upload</button>
</form>
