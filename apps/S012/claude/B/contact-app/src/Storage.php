<?php
declare(strict_types=1);

/**
 * Append-only, file-based store for contact submissions.
 *
 * Records are written as JSON Lines (one JSON object per line). JSON avoids
 * the delimiter/formula-injection pitfalls of CSV, and per-field values are
 * still HTML-escaped at render time. All reads/writes are guarded with an
 * advisory lock so concurrent requests cannot interleave.
 */
final class Storage
{
    public function __construct(private string $file)
    {
        $dir = dirname($this->file);
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create data directory.');
        }
    }

    /**
     * Append one submission. A server-generated UTC timestamp is added; any
     * caller-supplied timestamp is ignored.
     *
     * @param array{name:string,email:string,message:string} $row
     */
    public function append(array $row): void
    {
        $record = [
            'name'      => $row['name'],
            'email'     => $row['email'],
            'message'   => $row['message'],
            'timestamp' => gmdate('c'),
        ];

        $line = json_encode(
            $record,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        ) . "\n";

        $fh = fopen($this->file, 'ab');
        if ($fh === false) {
            throw new RuntimeException('Unable to open data file for writing.');
        }
        try {
            if (!flock($fh, LOCK_EX)) {
                throw new RuntimeException('Unable to lock data file.');
            }
            fwrite($fh, $line);
            fflush($fh);
            flock($fh, LOCK_UN);
        } finally {
            fclose($fh);
        }
    }

    /**
     * Return every submission, oldest first.
     *
     * @return list<array{name:string,email:string,message:string,timestamp:string}>
     */
    public function all(): array
    {
        if (!is_file($this->file)) {
            return [];
        }

        $out = [];
        $fh = fopen($this->file, 'rb');
        if ($fh === false) {
            return [];
        }
        try {
            if (flock($fh, LOCK_SH)) {
                while (($line = fgets($fh)) !== false) {
                    $line = trim($line);
                    if ($line === '') {
                        continue;
                    }
                    $decoded = json_decode($line, true);
                    if (is_array($decoded)) {
                        $out[] = $decoded;
                    }
                }
                flock($fh, LOCK_UN);
            }
        } finally {
            fclose($fh);
        }
        return $out;
    }
}
