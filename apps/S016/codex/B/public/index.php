<?php

declare(strict_types=1);

use SecurePoll\App;

require dirname(__DIR__) . '/src/App.php';

$app = new App();
$app->run();
