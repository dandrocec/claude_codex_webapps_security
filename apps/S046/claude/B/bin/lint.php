<?php
declare(strict_types=1);
// Dev-only helper: syntax-check every PHP file without executing them.
$root = dirname(__DIR__);
$rii = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
);
$fail = 0;
foreach ($rii as $file) {
    if ($file->getExtension() !== 'php') {
        continue;
    }
    $path = $file->getPathname();
    if (str_contains($path, DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR)) {
        continue;
    }
    $out = [];
    $code = 0;
    exec('php -l ' . escapeshellarg($path) . ' 2>&1', $out, $code);
    if ($code !== 0) {
        $fail++;
        echo implode("\n", $out), "\n";
    }
}
echo $fail === 0 ? "All files OK\n" : "$fail file(s) failed\n";
exit($fail === 0 ? 0 : 1);
