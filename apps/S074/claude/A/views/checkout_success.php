<?php /** @var int $order_id  @var int $total */ ?>
<div class="panel narrow" style="text-align:center;">
    <h1>🎉 Order confirmed</h1>
    <p>Thank you! Your order <strong>#<?= (int) $order_id ?></strong> for
       <strong><?= money($total) ?></strong> has been placed.</p>
    <p class="muted">Each vendor in your order has been notified of their items.</p>
    <p style="margin-top:18px;">
        <a class="btn" href="/orders">View my orders</a>
        <a class="btn secondary" href="/">Keep shopping</a>
    </p>
</div>
